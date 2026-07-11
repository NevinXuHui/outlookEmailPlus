#!/bin/bash

# ==============================================================================
# Outlook Email Plus 启动脚本
# ==============================================================================
# 用途：简化应用启动流程，自动处理环境检查、依赖安装和应用启动
# ==============================================================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示横幅
show_banner() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║                                                        ║${NC}"
    echo -e "${BLUE}║        Outlook Email Plus 临时邮箱管理系统            ║${NC}"
    echo -e "${BLUE}║                                                        ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# 检查 Python 版本
check_python() {
    log_info "检查 Python 版本..."
    
    if ! command -v python3 &> /dev/null; then
        log_error "未找到 Python 3，请先安装 Python 3.8 或更高版本"
        exit 1
    fi
    
    python_version=$(python3 --version | awk '{print $2}')
    log_success "Python 版本: ${python_version}"
}

# 检查并创建虚拟环境
setup_venv() {
    if [ ! -d "venv" ]; then
        log_info "创建虚拟环境..."
        python3 -m venv venv
        log_success "虚拟环境创建成功"
    else
        log_info "虚拟环境已存在"
    fi
}

# 激活虚拟环境
activate_venv() {
    log_info "激活虚拟环境..."
    source venv/bin/activate
    log_success "虚拟环境已激活"
}

# 安装依赖
install_dependencies() {
    log_info "检查依赖..."
    
    if [ -f "requirements.txt" ]; then
        log_info "安装 Python 依赖..."
        pip install -q --upgrade pip
        pip install -q -r requirements.txt
        log_success "依赖安装完成"
    else
        log_error "未找到 requirements.txt 文件"
        exit 1
    fi
}

# 检查必要的目录
ensure_directories() {
    log_info "检查必要目录..."
    
    directories=("data" ".runtime" "plugins")
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log_success "创建目录: $dir"
        fi
    done
}

# 检查端口是否被占用，并返回占用该端口的 PID
check_port_pid() {
    local port=$1
    lsof -ti:$port 2>/dev/null
}

# 杀掉占用指定端口的进程
kill_port_process() {
    local port=$1
    local pids=$(check_port_pid $port)
    
    if [ -n "$pids" ]; then
        log_warning "发现占用端口 $port 的进程: $pids"
        log_info "正在终止旧进程..."
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
        
        # 再次检查
        if [ -z "$(check_port_pid $port)" ]; then
            log_success "旧进程已终止，端口 $port 已释放"
            return 0
        else
            log_error "无法终止占用端口 $port 的进程"
            return 1
        fi
    fi
    return 0
}

# 启动应用
start_app() {
    log_info "启动应用..."

    # 端口固定 5000；启动前自动清理旧进程
    local default_port=5000
    export PORT="${default_port}"
    export HOST="${HOST:-0.0.0.0}"

    local pids
    pids=$(check_port_pid "$default_port" || true)
    if [ -n "$pids" ]; then
        log_warning "端口 ${default_port} 已被占用 (PID: $pids)，自动清理..."
        kill_port_process "$default_port" || exit 1
    else
        log_info "端口 ${default_port} 空闲"
    fi

    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  应用正在启动...${NC}"
    echo -e "${GREEN}  访问地址: ${BLUE}http://localhost:${default_port}${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # 启动应用
    python3 start.py
}

# 主函数
main() {
    show_banner
    check_python
    setup_venv
    activate_venv
    install_dependencies
    ensure_directories
    start_app
}

# 运行主函数
main