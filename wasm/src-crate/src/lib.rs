const INPUT_CAPACITY: usize = 1024 * 1024;
static mut INPUT: [u8; INPUT_CAPACITY] = [0; INPUT_CAPACITY];

#[repr(u32)]
enum Code {
    Pass = 0,
    NotObject = 1,
    NoCode = 2,
    Array = 3,
    InvalidUtf8 = 4,
    Secret = 5,
    SplitPrefix = 6,
    ShellCapNoBinding = 7,
    ChildProcessNoExec = 8,
    UnguardedInterpolate = 9,
}

fn find_bytes(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|window| window == needle)
}

fn ascii_lower(byte: u8) -> u8 {
    if byte.is_ascii_uppercase() {
        byte + 32
    } else {
        byte
    }
}

fn find_bytes_ignore_ascii_case(hay: &[u8], needle: &[u8]) -> bool {
    if needle.len() > hay.len() {
        return false;
    }
    hay.windows(needle.len()).any(|window| {
        window
            .iter()
            .zip(needle)
            .all(|(left, right)| ascii_lower(*left) == ascii_lower(*right))
    })
}

fn has_secret(whole: &[u8]) -> bool {
    if find_bytes(whole, b"sk-") {
        if let Some(start) = whole.windows(3).position(|window| window == b"sk-") {
            let rest = &whole[start + 3..];
            let n = rest
                .iter()
                .take_while(|byte| byte.is_ascii_alphanumeric())
                .count();
            if n >= 20 {
                return true;
            }
        }
    }
    if find_bytes(whole, b"glpat-") {
        if let Some(start) = whole.windows(6).position(|window| window == b"glpat-") {
            let rest = &whole[start + 6..];
            let n = rest
                .iter()
                .take_while(|byte| byte.is_ascii_alphanumeric() || **byte == b'_' || **byte == b'-')
                .count();
            if n >= 16 {
                return true;
            }
        }
    }
    if find_bytes(whole, b"ghp_")
        || find_bytes(whole, b"gho_")
        || find_bytes(whole, b"ghs_")
        || find_bytes(whole, b"ghr_")
        || find_bytes(whole, b"ghu_")
    {
        return true;
    }
    if find_bytes(whole, b"AKIA") {
        return true;
    }
    find_bytes_ignore_ascii_case(whole, b"Bearer ")
}

fn has_split_prefix(code: &[u8]) -> bool {
    find_bytes(code, b"sk-") && find_bytes(code, b"+")
        || find_bytes(code, b"glpat-") && find_bytes(code, b"+")
        || find_bytes(code, b"ghp_") && find_bytes(code, b"+")
        || find_bytes_ignore_ascii_case(code, b"Bearer") && find_bytes(code, b"+")
}

fn extract_json_string_field<'a>(json: &'a [u8], key: &[u8]) -> Option<&'a [u8]> {
    let mut pattern = Vec::with_capacity(key.len() + 3);
    pattern.push(b'"');
    pattern.extend_from_slice(key);
    pattern.extend_from_slice(b"\":");
    let Some(start) = json.windows(pattern.len()).position(|window| window == pattern.as_slice())
    else {
        return None;
    };
    let mut i = start + pattern.len();
    while i < json.len() && json[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= json.len() || json[i] != b'"' {
        return None;
    }
    i += 1;
    let begin = i;
    while i < json.len() && json[i] != b'"' {
        if json[i] == b'\\' {
            i += 2;
            continue;
        }
        i += 1;
    }
    Some(&json[begin..i.min(json.len())])
}

fn has_machine_shell_cap(json: &[u8]) -> bool {
    find_bytes(json, b"\"machine.shell\"")
}

fn has_machine_exec_cap(json: &[u8]) -> bool {
    find_bytes(json, b"\"machine.exec\"")
}

fn uses_shell_binding(code: &[u8]) -> bool {
    find_bytes(code, b"machine.shell(") || find_bytes(code, b"machine.shell (")
}

fn loads_child_process(code: &[u8]) -> bool {
    find_bytes(code, b"node:child_process")
}

fn interpolates_input(code: &[u8]) -> bool {
    (find_bytes(code, b"${") && (find_bytes(code, b"input") || find_bytes(code, b"project")))
        || find_bytes(code, b"+ project")
        || find_bytes(code, b"+ input")
        || find_bytes(code, b"+input")
        || find_bytes(code, b"+project")
}

fn has_traversal_guard(code: &[u8]) -> bool {
    find_bytes(code, b"..")
        || find_bytes(code, b"startsWith(\"/\")")
        || find_bytes(code, b"startsWith('/')")
}

fn has_char_allowlist(code: &[u8]) -> bool {
    find_bytes(code, b"test(") && find_bytes(code, b"project")
}

fn classify(json: &[u8]) -> Code {
    if json.first() == Some(&b'[') {
        return Code::Array;
    }
    if json.first() != Some(&b'{') {
        return Code::NotObject;
    }
    let Some(code) = extract_json_string_field(json, b"code") else {
        return Code::NoCode;
    };
    if has_secret(json) {
        return Code::Secret;
    }
    if has_split_prefix(code) {
        return Code::SplitPrefix;
    }
    if has_machine_shell_cap(json) && !uses_shell_binding(code) {
        return Code::ShellCapNoBinding;
    }
    if loads_child_process(code) && !has_machine_exec_cap(json) {
        return Code::ChildProcessNoExec;
    }
    if interpolates_input(code) && !(has_traversal_guard(code) && has_char_allowlist(code)) {
        return Code::UnguardedInterpolate;
    }
    Code::Pass
}

#[unsafe(no_mangle)]
pub extern "C" fn recipe_safety_input_ptr() -> *mut u8 {
    (&raw mut INPUT).cast::<u8>()
}

#[unsafe(no_mangle)]
pub extern "C" fn recipe_safety_input_capacity() -> u32 {
    INPUT_CAPACITY as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn recipe_safety_validate(length: u32) -> u32 {
    let length = length as usize;
    if length > INPUT_CAPACITY {
        return Code::InvalidUtf8 as u32;
    }
    let input = unsafe { std::slice::from_raw_parts((&raw const INPUT).cast::<u8>(), length) };
    if std::str::from_utf8(input).is_err() {
        return Code::InvalidUtf8 as u32;
    }
    classify(input) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(json: &str) -> u32 {
        classify(json.as_bytes()) as u32
    }

    #[test]
    fn pass_clean() {
        assert_eq!(
            run(r#"{"name":"clean","code":"return 42;","capabilities":["workspace.none"]}"#),
            Code::Pass as u32
        );
    }

    #[test]
    fn block_secret() {
        let secret = format!(
            r#"{{"name":"leaky","code":"const k=\"sk-{}\"; return k;"}}"#,
            "A".repeat(24)
        );
        assert_eq!(run(&secret), Code::Secret as u32);
    }

    #[test]
    fn block_unguarded() {
        assert_eq!(
            run(
                r#"{"name":"unguarded","code":"return { command: 'cd ' + input.project };"}"#
            ),
            Code::UnguardedInterpolate as u32
        );
    }

    #[test]
    fn fail_closed_no_code() {
        assert_eq!(run(r#"{"name":"x"}"#), Code::NoCode as u32);
    }
}
