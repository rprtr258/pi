#!/usr/bin/env bash
# Validate the structure of a skill directory.
#
# Checks:
#   - SKILL.md exists
#   - YAML frontmatter is present and has name + description
#   - name is kebab-case, max 64 chars
#   - description is under 1024 chars, no angle brackets
#   - SKILL.md is under 500 lines
#   - References are one level deep (no nested reference dirs)
#   - No extraneous files (README.md, CHANGELOG.md, etc.)
#   - Scripts are executable

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

error() { echo -e "${RED}ERROR${NC}: $1"; ERRORS=$((ERRORS + 1)); }
warn()  { echo -e "${YELLOW}WARN${NC}:  $1"; WARNINGS=$((WARNINGS + 1)); }
ok()    { echo -e "${GREEN}OK${NC}:    $1"; }

die() {
  echo "Error: $1" >&2
  exit "${2:-1}"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <path-to-skill>

Validate the structure of a skill directory.

Arguments:
  path-to-skill    Path to the skill directory containing SKILL.md
EOF
}

validate_frontmatter() {
  local skill_md="$1"
  local content frontmatter

  content=$(cat "$skill_md")

  if [[ ! "$content" =~ ^--- ]]; then
    error "No YAML frontmatter found (file must start with ---)"
    return 1
  fi

  frontmatter=$(echo "$content" | sed -n '/^---$/,/^---$/p' | sed '1d;$d')

  if [[ -z "$frontmatter" ]]; then
    error "Empty or malformed frontmatter"
    return 1
  fi
  ok "Frontmatter present"

  validate_name "$frontmatter"
  validate_description "$frontmatter"
}

validate_name() {
  local frontmatter="$1"
  local name

  name=$(echo "$frontmatter" | grep -E '^name:' | head -1 | sed 's/^name:[[:space:]]*//' | sed 's/^["'"'"']//' | sed 's/["'"'"']$//')

  if [[ -z "$name" ]]; then
    error "Missing 'name' in frontmatter"
    return
  fi

  ok "name: $name"

  if [[ ! "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
    error "name '$name' must be kebab-case (lowercase letters, digits, hyphens; no leading/trailing hyphens)"
  fi

  if [[ "$name" =~ -- ]]; then
    error "name '$name' contains consecutive hyphens"
  fi

  if [[ ${#name} -gt 64 ]]; then
    error "name is ${#name} chars (max 64)"
  fi
}

validate_description() {
  local frontmatter="$1"
  local desc_line desc desc_len

  desc_line=$(echo "$frontmatter" | grep -E '^description:' | head -1 | sed 's/^description:[[:space:]]*//')
  desc=$(echo "$desc_line" | sed 's/^["'"'"']//' | sed 's/["'"'"']$//')

  if [[ -z "$desc" ]]; then
    error "Missing 'description' in frontmatter"
    return
  fi

  desc_len=${#desc}
  ok "description: ${desc:0:80}..."

  if [[ $desc_len -gt 1024 ]]; then
    error "description is $desc_len chars (max 1024)"
  fi

  if echo "$desc" | grep -q '[<>]'; then
    error "description contains angle brackets (< or >)"
  fi
}

validate_line_count() {
  local skill_md="$1"
  local line_count

  line_count=$(wc -l < "$skill_md")
  if [[ $line_count -gt 500 ]]; then
    warn "SKILL.md is $line_count lines (recommended max: 500)"
  else
    ok "SKILL.md is $line_count lines"
  fi
}

validate_references() {
  local skill_dir="$1"
  local nested

  if [[ ! -d "$skill_dir/references" ]]; then
    return
  fi

  nested=$(find "$skill_dir/references" -mindepth 2 -type f 2>/dev/null | head -5)
  if [[ -n "$nested" ]]; then
    warn "Nested files found in references/ (should be one level deep):"
    echo "$nested" | while read -r f; do echo "  $f"; done
  else
    ok "References are one level deep"
  fi
}

validate_no_extraneous_files() {
  local skill_dir="$1"
  local extraneous

  for extraneous in README.md CHANGELOG.md INSTALLATION_GUIDE.md QUICK_REFERENCE.md; do
    if [[ -f "$skill_dir/$extraneous" ]]; then
      warn "Extraneous file: $extraneous (not needed in skills)"
    fi
  done
}

validate_script_executability() {
  local skill_dir="$1"

  if [[ ! -d "$skill_dir/scripts" ]]; then
    return
  fi

  while IFS= read -r -d '' script; do
    if [[ ! -x "$script" ]]; then
      warn "Script not executable: $script"
    fi
  done < <(find "$skill_dir/scripts" -type f -print0)
}

main() {
  if [[ $# -ne 1 ]]; then
    usage
    exit 1
  fi

  local skill_dir="$1"
  local skill_md="$skill_dir/SKILL.md"

  [[ -d "$skill_dir" ]] || die "Directory does not exist: $skill_dir"
  [[ -f "$skill_md" ]] || die "SKILL.md not found in $skill_dir"

  ok "SKILL.md exists"

  validate_frontmatter "$skill_md"
  validate_line_count "$skill_md"
  validate_references "$skill_dir"
  validate_no_extraneous_files "$skill_dir"
  validate_script_executability "$skill_dir"

  echo ""
  if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}FAILED${NC}: $ERRORS error(s), $WARNINGS warning(s)"
    exit 1
  elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}PASSED${NC} with $WARNINGS warning(s)"
    exit 0
  else
    echo -e "${GREEN}PASSED${NC}: All checks passed"
    exit 0
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
