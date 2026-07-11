#!/usr/bin/env bash
# ==============================================================================
# Outlook Email Plus — 裸机安装 / systemd 部署脚本
# ==============================================================================
# 用法：
#   ./install.sh                  # 安装依赖 + 准备环境（不装 systemd）
#   ./install.sh --systemd        # 安装依赖 + 注册 systemd 服务并启动
#   ./install.sh --systemd-only   # 仅安装/更新 systemd 单元（依赖已就绪时）
#   ./install.sh --uninstall      # 停止并移除 systemd 服务
#   ./install.sh --status         # 查看服务状态
#
# 环境变量（可选）：
#   APP_DIR      安装目录，默认脚本所在目录
#   APP_USER     运行用户，默认当前用户
#   APP_GROUP    运行组，默认当前用户主组
#   SKIP_PIP=1   跳过 pip 安装
#   NO_START=1   安装 systemd 后不自动启动
#
# 端口固定 5000；启动前会清理占用该端口的旧进程。
# ==============================================================================

set -euo pipefail

# ---------- 颜色 ----------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

die() { log_error "$*"; exit 1; }

# ---------- 路径与默认值 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_NAME="outlook-email-plus"
SERVICE_FILE_SRC="${APP_DIR}/deploy/outlook-email-plus.service"
SERVICE_FILE_DST="/etc/systemd/system/${SERVICE_NAME}.service"
VENV_DIR="${APP_DIR}/venv"
PYTHON_BIN="${VENV_DIR}/bin/python"
PIP_BIN="${VENV_DIR}/bin/pip"

APP_USER="${APP_USER:-$(id -un)}"
APP_GROUP="${APP_GROUP:-$(id -gn)}"
# 端口固定 5000，不允许自定义
APP_PORT=5000

DO_SYSTEMD=0
SYSTEMD_ONLY=0
DO_UNINSTALL=0
DO_STATUS=0

usage() {
    sed -n '2,18p' "$0" | sed 's/^# \?//'
    exit 0
}

# ---------- 参数解析 ----------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --systemd)      DO_SYSTEMD=1; shift ;;
        --systemd-only) SYSTEMD_ONLY=1; DO_SYSTEMD=1; shift ;;
        --uninstall)    DO_UNINSTALL=1; shift ;;
        --status)       DO_STATUS=1; shift ;;
        -h|--help)      usage ;;
        *)              die "未知参数: $1（使用 --help 查看用法）" ;;
    esac
done

require_root_for_systemd() {
    if [[ "$(id -u)" -ne 0 ]]; then
        die "安装/卸载 systemd 服务需要 root 权限，请使用: sudo $0 --systemd"
    fi
}

have_systemd() {
    command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]
}

# ---------- 环境检查 ----------
check_python() {
    log_info "检查 Python..."
    if ! command -v python3 >/dev/null 2>&1; then
        die "未找到 python3，请先安装 Python 3.8+"
    fi
    local ver
    ver="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
    python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' \
        || die "需要 Python >= 3.8，当前: ${ver}"
    log_success "Python ${ver}"
}

# ---------- 虚拟环境与依赖 ----------
setup_venv() {
    log_info "准备虚拟环境: ${VENV_DIR}"
    if [[ ! -d "${VENV_DIR}" ]]; then
        python3 -m venv "${VENV_DIR}"
        log_success "已创建 venv"
    else
        log_info "venv 已存在，跳过创建"
    fi
}

install_deps() {
    if [[ "${SKIP_PIP:-0}" == "1" ]]; then
        log_warning "SKIP_PIP=1，跳过依赖安装"
        return
    fi
    [[ -f "${APP_DIR}/requirements.txt" ]] || die "缺少 requirements.txt"

    log_info "安装 Python 依赖（含 gunicorn）..."
    "${PIP_BIN}" install -q --upgrade pip
    "${PIP_BIN}" install -q -r "${APP_DIR}/requirements.txt"
    "${PIP_BIN}" install -q "gunicorn>=21.0.0"
    log_success "依赖安装完成"
}

ensure_dirs() {
    log_info "确保运行目录存在..."
    mkdir -p "${APP_DIR}/data" "${APP_DIR}/.runtime" "${APP_DIR}/plugins"
    chmod +x "${APP_DIR}/scripts/start-gunicorn.sh" 2>/dev/null || true
    log_success "data / .runtime / plugins 就绪"
}

# ---------- .env ----------
ensure_env() {
    local env_file="${APP_DIR}/.env"
    local env_example="${APP_DIR}/.env.example"

    if [[ ! -f "${env_file}" ]]; then
        [[ -f "${env_example}" ]] || die "缺少 .env.example，无法生成 .env"
        cp "${env_example}" "${env_file}"
        log_success "已从 .env.example 生成 .env"
    else
        log_info ".env 已存在，保留现有配置"
    fi

    # 自动生成 SECRET_KEY（占位符或空时）
    local current_key
    current_key="$(grep -E '^SECRET_KEY=' "${env_file}" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
    if [[ -z "${current_key}" || "${current_key}" == "your-secret-key-here" ]]; then
        local new_key
        new_key="$(${PYTHON_BIN} -c 'import secrets; print(secrets.token_hex(32))')"
        if grep -qE '^SECRET_KEY=' "${env_file}"; then
            # 兼容 macOS/GNU sed
            if sed --version >/dev/null 2>&1; then
                sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${new_key}|" "${env_file}"
            else
                sed -i '' "s|^SECRET_KEY=.*|SECRET_KEY=${new_key}|" "${env_file}"
            fi
        else
            printf 'SECRET_KEY=%s\n' "${new_key}" >> "${env_file}"
        fi
        log_success "已生成 SECRET_KEY（请备份 .env）"
        log_warning "SECRET_KEY 丢失将无法解密历史敏感数据"
    fi

    # 强制固定 PORT=5000 / GUNICORN_BIND=0.0.0.0:5000
    set_env_kv() {
        local key="$1" value="$2"
        if grep -qE "^${key}=" "${env_file}"; then
            if sed --version >/dev/null 2>&1; then
                sed -i "s|^${key}=.*|${key}=${value}|" "${env_file}"
            else
                sed -i '' "s|^${key}=.*|${key}=${value}|" "${env_file}"
            fi
        else
            printf '%s=%s\n' "${key}" "${value}" >> "${env_file}"
        fi
    }
    set_env_kv "PORT" "5000"
    set_env_kv "GUNICORN_BIND" "0.0.0.0:5000"
    log_info "已固定 PORT=5000 / GUNICORN_BIND=0.0.0.0:5000"
}

# 清理占用 5000 的旧进程（systemd 之外的 Flask/gunicorn 残留）
clear_port_5000() {
    local port=5000
    local pids=""

    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    fi
    if [[ -z "${pids}" ]] && command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "${port}/tcp" 2>/dev/null | tr -s '[:space:]' '\n' | grep -E '^[0-9]+$' || true)"
    fi
    if [[ -z "${pids}" ]] && command -v ss >/dev/null 2>&1; then
        pids="$(ss -lptn "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)"
    fi

    if [[ -z "${pids}" ]]; then
        log_info "端口 ${port} 空闲"
        return 0
    fi

    log_warning "清理占用端口 ${port} 的旧进程: $(echo "${pids}" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
    sleep 1
    local still=""
    if command -v lsof >/dev/null 2>&1; then
        still="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    fi
    if [[ -n "${still}" ]]; then
        # shellcheck disable=SC2086
        kill -9 ${still} 2>/dev/null || true
        sleep 1
    fi

    if command -v lsof >/dev/null 2>&1 && [[ -n "$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
        die "无法释放端口 ${port}"
    fi
    log_success "端口 ${port} 已释放"
}

# ---------- systemd ----------
render_unit() {
    [[ -f "${SERVICE_FILE_SRC}" ]] || die "缺少单元模板: ${SERVICE_FILE_SRC}"

    # 用 | 作分隔符，避免路径中的 /
    sed \
        -e "s|__APP_DIR__|${APP_DIR}|g" \
        -e "s|__APP_USER__|${APP_USER}|g" \
        -e "s|__APP_GROUP__|${APP_GROUP}|g" \
        "${SERVICE_FILE_SRC}"
}

install_systemd() {
    require_root_for_systemd
    have_systemd || die "当前系统未运行 systemd，无法注册服务"

    # 校验运行用户
    id "${APP_USER}" >/dev/null 2>&1 || die "用户不存在: ${APP_USER}"

    log_info "安装 systemd 单元 → ${SERVICE_FILE_DST}"
    render_unit > "${SERVICE_FILE_DST}"

    # 目录权限：运行用户可写 data/.runtime/plugins
    chown -R "${APP_USER}:${APP_GROUP}" \
        "${APP_DIR}/data" "${APP_DIR}/.runtime" "${APP_DIR}/plugins" 2>/dev/null || true
    # .env 仅所有者可读
    if [[ -f "${APP_DIR}/.env" ]]; then
        chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/.env"
        chmod 600 "${APP_DIR}/.env"
    fi

    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}.service"
    log_success "已 enable ${SERVICE_NAME}"

    if [[ "${NO_START:-0}" == "1" ]]; then
        log_warning "NO_START=1，跳过启动"
    else
        # 先停服务，再清端口残留，再启动
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
        clear_port_5000
        systemctl start "${SERVICE_NAME}.service"
        sleep 1
        if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
            log_success "服务已启动（:5000）"
        else
            log_error "服务启动失败，最近日志："
            journalctl -u "${SERVICE_NAME}" -n 40 --no-pager || true
            exit 1
        fi
    fi
}

uninstall_systemd() {
    require_root_for_systemd
    if [[ -f "${SERVICE_FILE_DST}" ]] || systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
        systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true
        systemctl disable "${SERVICE_NAME}.service" 2>/dev/null || true
        rm -f "${SERVICE_FILE_DST}"
        systemctl daemon-reload
        systemctl reset-failed 2>/dev/null || true
        log_success "已移除 ${SERVICE_NAME} 服务"
    else
        log_warning "未找到已安装的 ${SERVICE_NAME} 服务"
    fi
    log_info "项目文件与 data/ 未删除（需手动清理）"
}

show_status() {
    if have_systemd && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
        systemctl status "${SERVICE_NAME}.service" --no-pager || true
        echo ""
        log_info "常用命令："
        echo "  sudo systemctl status  ${SERVICE_NAME}"
        echo "  sudo systemctl restart ${SERVICE_NAME}"
        echo "  sudo systemctl stop    ${SERVICE_NAME}"
        echo "  sudo journalctl -u ${SERVICE_NAME} -f"
    else
        log_warning "systemd 服务未安装。开发模式可执行: ./run.sh"
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Outlook Email Plus 安装完成${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo "  目录:   ${APP_DIR}"
    echo "  用户:   ${APP_USER}:${APP_GROUP}"
    echo "  端口:   5000（固定）"
    echo "  访问:   http://127.0.0.1:5000"
    if [[ "${DO_SYSTEMD}" -eq 1 ]]; then
        echo "  服务:   systemctl status ${SERVICE_NAME}"
        echo "  日志:   journalctl -u ${SERVICE_NAME} -f"
    else
        echo "  启动:   ./run.sh            # 开发（Flask，自动清旧进程）"
        echo "          或 sudo $0 --systemd  # 生产（gunicorn + systemd）"
    fi
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ---------- 主流程 ----------
main() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     Outlook Email Plus  Installer / systemd           ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [[ "${DO_STATUS}" -eq 1 ]]; then
        show_status
        exit 0
    fi

    if [[ "${DO_UNINSTALL}" -eq 1 ]]; then
        uninstall_systemd
        exit 0
    fi

    cd "${APP_DIR}"

    if [[ "${SYSTEMD_ONLY}" -eq 0 ]]; then
        check_python
        setup_venv
        install_deps
        ensure_dirs
        ensure_env
    else
        [[ -x "${PYTHON_BIN}" ]] || die "未找到 venv，请先执行: $0"
        ensure_dirs
        ensure_env
    fi

    if [[ "${DO_SYSTEMD}" -eq 1 ]]; then
        install_systemd
    fi

    print_summary
}

main
