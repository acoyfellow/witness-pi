# The working --temporary incantation (2026-07-12)

Local wrangler is 4.82 (too old); use `bunx wrangler@latest` (>=4.102).
You're normally authed, and --temporary refuses when authed OR when
CLOUDFLARE_* env tokens are set. Full isolation via `env -i` with a throwaway HOME:

    env -i HOME=/tmp/h40home-$$ PATH="$PATH" XDG_CONFIG_HOME=/tmp/h40cfg-$$ bash -c '
      mkdir -p "$HOME" "$XDG_CONFIG_HOME"; cd <worker-dir>
      echo y | bunx wrangler@latest deploy --temporary'

Prints: temp account name, Claim URL (60 min), and a workers.dev URL.
Do NOT claim (let it expire). R2 is NOT supported on temp accounts; DO/KV/D1/Queues are.
