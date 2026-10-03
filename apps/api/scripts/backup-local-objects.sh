#!/bin/sh
set -eu

objects_dir=${LOCAL_OBJECTS_DIR:?LOCAL_OBJECTS_DIR must be set}
backup_dir=${LOCAL_BACKUP_DIR:?LOCAL_BACKUP_DIR must be set}
retention_days=${LOCAL_BACKUP_RETENTION_DAYS:-14}

case "$objects_dir" in /|''|[!/]*) echo 'LOCAL_OBJECTS_DIR 必须是非根绝对路径' >&2; exit 2 ;; esac
case "$backup_dir" in /|''|[!/]*) echo 'LOCAL_BACKUP_DIR 必须是非根绝对路径' >&2; exit 2 ;; esac
case "$retention_days" in ''|*[!0-9]*) echo 'LOCAL_BACKUP_RETENTION_DAYS 必须是非负整数' >&2; exit 2 ;; esac

mkdir -p -- "$objects_dir" "$backup_dir"
objects_real=$(realpath -e -- "$objects_dir")
backup_real=$(realpath -e -- "$backup_dir")
case "$backup_real" in
  "$objects_real"|"$objects_real"/*) echo 'LOCAL_BACKUP_DIR 不得位于 LOCAL_OBJECTS_DIR 内' >&2; exit 2 ;;
esac
case "$objects_real" in
  "$backup_real"|"$backup_real"/*) echo 'LOCAL_OBJECTS_DIR 不得位于 LOCAL_BACKUP_DIR 内' >&2; exit 2 ;;
esac

lock_file="$backup_real/.backup.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$lock_file"
  flock -n 9 || { echo '已有本地对象备份正在运行' >&2; exit 3; }
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_real/objects-$stamp-$$.tar.gz"
temporary=$(mktemp "$backup_real/.objects-$stamp-XXXXXX")
temporary_checksum="$temporary.sha256"
cleanup() {
  rm -f -- "$temporary" "$temporary_checksum"
}
trap cleanup EXIT HUP INT TERM

tar -C "$objects_real" -czf "$temporary" .
digest=$(sha256sum -- "$temporary" | awk '{print $1}')
printf '%s  %s\n' "$digest" "$(basename "$archive")" > "$temporary_checksum"
mv -f -- "$temporary" "$archive"
mv -f -- "$temporary_checksum" "$archive.sha256"
trap - EXIT HUP INT TERM

find "$backup_real" -type f -name 'objects-*.tar.gz' -mtime "+$retention_days" -delete
find "$backup_real" -type f -name 'objects-*.tar.gz.sha256' -mtime "+$retention_days" -delete
printf '%s\n' "$archive"
