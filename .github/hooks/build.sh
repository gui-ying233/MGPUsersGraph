#!/bin/bash

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // ""')

output=$(echo "$input" | jq '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse"
  }
}')

if [[ "$tool_name" == "replace_string_in_file" || "$tool_name" == "edit_notebook_file" || "$tool_name" == "create_file" || "$tool_name" == "multi_replace_string_in_file" ]]; then
  files=$(echo "$input" | jq -r '(.tool_input.filePath // empty), (.tool_input.filePaths[]? // empty), (.tool_input.replacements[]?.filePath // empty)' 2>/dev/null | grep -v '^$')
  
  build_needed=false
  generate_needed=false
  
  while IFS= read -r file; do
    if [[ $file =~ ^/.*/?src/ ]]; then
      build_needed=true
    fi
    if [[ $file == *"scripts/generateGraphData.js" ]]; then
      generate_needed=true
    fi
  done <<< "$files"
  
  if [[ "$generate_needed" == true ]]; then
    pnpm run generate > /dev/null 2>&1
    context="已自动运行 pnpm run generate"
  fi
  
  if [[ "$build_needed" == true ]]; then
    pnpm run build > /dev/null 2>&1
    if [[ "$generate_needed" == true ]]; then
      context="已自动运行 pnpm run generate 和 pnpm run build"
    else
      context="已自动运行 pnpm run build"
    fi
  fi
  
  if [[ -n "$context" ]]; then
    output=$(echo "$output" | jq ".hookSpecificOutput.additionalContext |= \"$context\"")
  fi
fi

echo "$output"
