#!/bin/bash

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // ""')
tool_input=$(echo "$input" | jq '.tool_input // {}')
command=$(echo "$tool_input" | jq -r '.command // ""')
file_path=$(echo "$tool_input" | jq -r '.filePath // ""')

should_ask=false
deny_reason=""

if [[ "$tool_name" == "run_in_terminal" ]]; then
  if [[ "$command" =~ git\ push ]]; then
    should_ask=true
    deny_reason="禁止执行 git push"
  elif [[ "$command" =~ git\ reset|git\ clean ]]; then
    should_ask=true
    deny_reason="禁止清除暂存区"
  fi
fi

if [[ "$tool_name" == "create_file" ]] && [[ "$file_path" =~ \.md$ ]]; then
  should_ask=true
  deny_reason="禁止创建 .md 文件"
fi

if [[ "$should_ask" == true ]]; then
  output=$(echo "$input" | jq \
    --arg reason "$deny_reason" \
    '.hookSpecificOutput = {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: $reason
    }')
  echo "$output"
  exit 0
else
  output=$(echo "$input" | jq '.hookSpecificOutput = { hookEventName: "PreToolUse" }')
  echo "$output"
  exit 0
fi
