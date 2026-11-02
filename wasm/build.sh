#!/bin/sh
set -eu

wasm_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest="$wasm_dir/src-crate/Cargo.toml"
artifact="$wasm_dir/src-crate/target/wasm32-unknown-unknown/release/recipe_safety.wasm"
output="$wasm_dir/recipe_safety.wasm"
expected_file="$wasm_dir/recipe_safety.sha256"

rustup target add wasm32-unknown-unknown || true
toolchain_bin=$(dirname -- "$(rustup which cargo)")
PATH="$toolchain_bin:$PATH"
export PATH
cargo test --manifest-path "$manifest"
cargo build --release --target wasm32-unknown-unknown --manifest-path "$manifest"
cp "$artifact" "$output"

if [ -f "$expected_file" ]; then
  expected=$(tr -d '[:space:]' < "$expected_file")
  actual=$(shasum -a 256 "$output" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    printf 'sha256 mismatch: expected %s, got %s\n' "$expected" "$actual" >&2
    exit 1
  fi
  printf 'sha256 verified: %s\n' "$actual"
else
  shasum -a 256 "$output" | awk '{print $1}' > "$expected_file"
  printf 'sha256 recorded: %s\n' "$(cat "$expected_file")"
fi
