#!/bin/bash
# SkyMail 插件打包脚本

set -e

PLUGIN_DIR="plugins/temp_mail_providers/skymail"
OUTPUT_DIR="dist"
PLUGIN_NAME="skymail-provider-v1.0.0"

echo "=================================="
echo "SkyMail Provider 插件打包工具"
echo "=================================="

# 1. 检查目录
if [ ! -d "$PLUGIN_DIR" ]; then
    echo "❌ 错误：找不到插件目录 $PLUGIN_DIR"
    exit 1
fi

echo "✓ 插件目录检查通过"

# 2. 验证插件结构
echo ""
echo "运行结构验证..."
python3 "$PLUGIN_DIR/verify.py"
if [ $? -ne 0 ]; then
    echo "❌ 插件验证失败，请检查后重试"
    exit 1
fi

# 3. 创建输出目录
mkdir -p "$OUTPUT_DIR"
echo ""
echo "✓ 输出目录: $OUTPUT_DIR"

# 4. 清理旧文件
rm -f "$OUTPUT_DIR/$PLUGIN_NAME.zip" "$OUTPUT_DIR/$PLUGIN_NAME.tar.gz"

# 5. 打包为 ZIP（Windows 友好）
echo ""
echo "打包 ZIP 格式..."
(cd "$(dirname $PLUGIN_DIR)" && \
    zip -r "../../$OUTPUT_DIR/$PLUGIN_NAME.zip" "$(basename $PLUGIN_DIR)" \
    -x "*.pyc" "*__pycache__*" "*.DS_Store" ".git*" "verify.py" "package.sh")

echo "✓ 已生成: $OUTPUT_DIR/$PLUGIN_NAME.zip"

# 6. 打包为 tar.gz（Linux/Mac 友好）
echo ""
echo "打包 tar.gz 格式..."
tar -czf "$OUTPUT_DIR/$PLUGIN_NAME.tar.gz" \
    --exclude="*.pyc" \
    --exclude="*__pycache__*" \
    --exclude=".DS_Store" \
    --exclude="verify.py" \
    --exclude="package.sh" \
    -C "$(dirname $PLUGIN_DIR)" \
    "$(basename $PLUGIN_DIR)"

echo "✓ 已生成: $OUTPUT_DIR/$PLUGIN_NAME.tar.gz"

# 7. 生成校验和
echo ""
echo "生成校验和..."
cd "$OUTPUT_DIR"
sha256sum "$PLUGIN_NAME.zip" > "$PLUGIN_NAME.zip.sha256"
sha256sum "$PLUGIN_NAME.tar.gz" > "$PLUGIN_NAME.tar.gz.sha256"
cd - > /dev/null

echo "✓ 已生成校验和文件"

# 8. 显示结果
echo ""
echo "=================================="
echo "打包完成！"
echo "=================================="
echo ""
ls -lh "$OUTPUT_DIR/$PLUGIN_NAME"*
echo ""
echo "安装方法："
echo "  1. 解压 ZIP/tar.gz 到 plugins/temp_mail_providers/"
echo "  2. 确保目录结构为: plugins/temp_mail_providers/skymail/"
echo "  3. 重启 OutlookMail Plus"
echo "  4. 在「系统设置」→「临时邮箱插件」中配置"
echo ""
echo "文档："
echo "  - README.md: 完整功能说明"
echo "  - QUICKSTART.md: 快速上手指南"
