#!/bin/bash

input=$(cat)

output=$(echo "$input" | jq '
  .tool_input.command as $cmd |
  if ($cmd | test("\\bnpm\\b")) then
    .tool_input.command |= gsub("\\bnpm\\b"; "pnpm") |
    .hookSpecificOutput = {
      hookEventName: "PreToolUse",
      updatedInput: .tool_input,
      additionalContext: "自动转换：npm → pnpm"
    }
  else
    .hookSpecificOutput = {
      hookEventName: "PreToolUse"
    }
  end
')

echo "$output"
