#!/usr/bin/env python3
"""
SkyMail Provider 插件验证脚本（无需运行环境）
"""
import ast
import json
import os
import sys

def check_file_exists(path, description):
    """检查文件是否存在"""
    if os.path.exists(path):
        print(f"✓ {description}: {path}")
        return True
    else:
        print(f"✗ {description} 缺失: {path}")
        return False

def check_python_syntax(filepath):
    """检查 Python 文件语法"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            ast.parse(f.read())
        print(f"✓ Python 语法检查通过: {filepath}")
        return True
    except SyntaxError as e:
        print(f"✗ 语法错误 {filepath}: {e}")
        return False

def check_json_syntax(filepath):
    """检查 JSON 文件语法"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"✓ JSON 格式检查通过: {filepath}")
        return data
    except json.JSONDecodeError as e:
        print(f"✗ JSON 格式错误 {filepath}: {e}")
        return None

def extract_class_info(filepath):
    """提取 Python 类信息"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            tree = ast.parse(f.read())
        
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                # 查找类属性
                attrs = {}
                for item in node.body:
                    if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                        # 类型注解的属性
                        attrs[item.target.id] = None
                    elif isinstance(item, ast.Assign):
                        # 普通赋值的属性
                        for target in item.targets:
                            if isinstance(target, ast.Name):
                                if isinstance(item.value, ast.Constant):
                                    attrs[target.id] = item.value.value
                
                # 查找方法
                methods = [item.name for item in node.body if isinstance(item, ast.FunctionDef)]
                
                return {
                    'class_name': node.class_name,
                    'attributes': attrs,
                    'methods': methods
                }
    except Exception as e:
        print(f"⚠ 无法提取类信息 {filepath}: {e}")
        return None

def main():
    print("=" * 60)
    print("SkyMail Provider 插件结构验证")
    print("=" * 60)
    
    plugin_dir = "plugins/temp_mail_providers/skymail"
    all_checks = []
    
    # 1. 检查文件结构
    print("\n[1] 文件结构检查:")
    all_checks.append(check_file_exists(f"{plugin_dir}/__init__.py", "模块初始化文件"))
    all_checks.append(check_file_exists(f"{plugin_dir}/skymail.py", "主实现文件"))
    all_checks.append(check_file_exists(f"{plugin_dir}/plugin.json", "插件元数据"))
    all_checks.append(check_file_exists(f"{plugin_dir}/README.md", "插件文档"))
    
    # 2. 检查语法
    print("\n[2] 语法检查:")
    all_checks.append(check_python_syntax(f"{plugin_dir}/__init__.py"))
    all_checks.append(check_python_syntax(f"{plugin_dir}/skymail.py"))
    
    # 3. 检查 JSON 元数据
    print("\n[3] 插件元数据检查:")
    plugin_meta = check_json_syntax(f"{plugin_dir}/plugin.json")
    if plugin_meta:
        print(f"  名称: {plugin_meta.get('name')}")
        print(f"  版本: {plugin_meta.get('version')}")
        print(f"  标签: {plugin_meta.get('label')}")
        print(f"  作者: {plugin_meta.get('author')}")
        print(f"  描述: {plugin_meta.get('description')}")
        all_checks.append(True)
    else:
        all_checks.append(False)
    
    # 4. 检查必需方法
    print("\n[4] 必需方法检查:")
    required_methods = [
        'get_options',
        'create_mailbox',
        'delete_mailbox',
        'list_messages',
        'get_message_detail',
        'delete_message',
        'clear_messages'
    ]
    
    try:
        with open(f"{plugin_dir}/skymail.py", 'r', encoding='utf-8') as f:
            content = f.read()
            for method in required_methods:
                if f"def {method}(" in content:
                    print(f"  ✓ {method}")
                    all_checks.append(True)
                else:
                    print(f"  ✗ {method} 缺失")
                    all_checks.append(False)
    except Exception as e:
        print(f"  ✗ 无法检查方法: {e}")
        all_checks.extend([False] * len(required_methods))
    
    # 5. 检查装饰器
    print("\n[5] Provider 注册检查:")
    try:
        with open(f"{plugin_dir}/skymail.py", 'r', encoding='utf-8') as f:
            content = f.read()
            if "@register_provider" in content:
                print("  ✓ 包含 @register_provider 装饰器")
                all_checks.append(True)
            else:
                print("  ✗ 缺少 @register_provider 装饰器")
                all_checks.append(False)
    except Exception as e:
        print(f"  ✗ 检查失败: {e}")
        all_checks.append(False)
    
    # 6. 总结
    print("\n" + "=" * 60)
    passed = sum(all_checks)
    total = len(all_checks)
    print(f"检查结果: {passed}/{total} 通过")
    
    if passed == total:
        print("✓ 所有检查通过！插件结构完整。")
        return 0
    else:
        print(f"⚠ {total - passed} 项检查未通过，请修复后再使用。")
        return 1

if __name__ == "__main__":
    sys.exit(main())
