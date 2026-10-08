#!/bin/sh
# Kompiliert alle .c-Dateien eines Ordners mit gcc und führt sie mit Eingaben aus <name>.in aus.
# Aufruf (WSL): sh tests/compile-c.sh <ordner>
dir="$1"
fail=0
for c in "$dir"/*.c; do
  name=$(basename "$c" .c)
  bin="/tmp/bbe_$name"
  if ! gcc -std=c99 -Wall -Wextra -Wno-unused-variable -o "$bin" "$c" 2>"/tmp/bbe_$name.err"; then
    echo "COMPILE FAIL $name"; cat "/tmp/bbe_$name.err"; fail=1; continue
  fi
  warn=$(grep -c warning "/tmp/bbe_$name.err")
  input=""
  [ -f "$dir/$name.in" ] && input=$(cat "$dir/$name.in")
  out=$(printf '%s\n' "$input" | timeout 5 "$bin" | tr '\n' '|')
  echo "ok   $name (warnings: $warn) -> $out"
  [ "$warn" != "0" ] && cat "/tmp/bbe_$name.err"
done
exit $fail
