#!/usr/bin/env bash

# Read JSON input from stdin
input=$(cat)

# Extract tool information
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
tool_input=$(echo "$input" | jq -r '.tool_input // {}')

# Check if this is a file editing tool
case "$tool_name" in
    Write|Edit)
        ;;
    *)
        exit 0
        ;;
esac

# Extract file path
file_path=$(echo "$tool_input" | jq -r '.file_path // ""')

# Check if we found a file path and it's a .go file
if [ -z "$file_path" ] || [[ ! "$file_path" =~ \.go$ ]]; then
    exit 0
fi

# Check if the file exists
if [ ! -f "$file_path" ]; then
    echo "File not found: $file_path" >&2
    exit 0
fi

# Run gofmt on the file
if command -v gofmt &> /dev/null; then
    if gofmt -w "$file_path"; then
        echo "Successfully formatted $file_path with gofmt"
    else
        echo "gofmt failed for $file_path" >&2
        exit 1
    fi
else
    echo "Error: gofmt not found. Please ensure Go is installed and gofmt is in your PATH" >&2
    exit 1
fi