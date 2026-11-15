#!/bin/bash
# Copies the shared board engine into Pupka (src/board). Run after every engine change.
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="$here/../Pupka/src/board"
mkdir -p "$dest"
cp "$here"/board/*.js "$here"/board/board.css "$dest"/
echo "synced $(ls "$dest" | wc -l | tr -d ' ') files to $dest"
