#!/usr/bin/env bash
set -euo pipefail

archive_root="${1:?archive root is required}"
mode="${2:-install}"
sdk_sha="$(node -e "const spec=require('./package.json').dependencies['@treeseed/sdk']; const match=spec.match(/#([0-9a-f]{40})$/); process.stdout.write(match?.[1] ?? '');")"

[[ -n "${sdk_sha}" ]]
mkdir -p "${archive_root}"

select_sdk_archive() {
  mapfile -t sdk_archives < <(find "${archive_root}" -name 'treeseed-sdk-*.tgz' -type f -print 2>/dev/null | sort)
  if (( ${#sdk_archives[@]} > 1 )); then
    echo "Multiple sealed SDK artifacts were found in ${archive_root}." >&2
    return 1
  fi
  printf '%s' "${sdk_archives[0]:-}"
}

sdk_archive="$(select_sdk_archive)"
if [[ -z "${sdk_archive}" ]]; then
  [[ "${mode}" == "download" ]]
  artifact_name="sdk-${sdk_sha}"
  run_id=""
  mapfile -t candidates < <(gh api "repos/treeseed-ai/sdk/actions/artifacts?name=${artifact_name}&per_page=100" --jq ".artifacts[] | select(.expired == false and .workflow_run.head_sha == \"${sdk_sha}\") | .workflow_run.id")
  for candidate in "${candidates[@]}"; do
    state="$(gh run view "${candidate}" --repo treeseed-ai/sdk --json headSha,status,conclusion --jq '[.headSha,.status,.conclusion]|join(" ")')"
    if [[ "${state}" == "${sdk_sha} completed success" ]]; then run_id="${candidate}"; break; fi
  done
  [[ -n "${run_id}" ]]
  gh run download "${run_id}" --repo treeseed-ai/sdk --name "${artifact_name}" --dir "${archive_root}"
  sdk_archive="$(select_sdk_archive)"
fi

[[ "${mode}" == "download" ]] && exit 0
[[ "${mode}" == "install" && -n "${sdk_archive}" ]]
target="node_modules/@treeseed/sdk"
find "${target}" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} +
tar -xzf "${sdk_archive}" --strip-components=1 -C "${target}"
test -d "${target}/dist"
npm ls --all --omit=dev >/dev/null
