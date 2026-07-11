#!/usr/bin/env python3
"""
SkyMail 插件独立验证脚本
不依赖 Flask 运行环境，纯静态分析
"""
import ast
import sys
from pathlib import Path


def verify_plugin():
    """验证插件文件"""
    plugin_path = Path(__file__).parent / "skymail.py"
    
    if not plugin_path.exists():
        print(f"✗ 插件文件不存在: {plugin_path}")
        return False
    
    print(f"验证文件: {plugin_path}")
    print(f"文件大小: {plugin_path.stat().st_size} 字节")
    
    # 1. 语法检查
    try:
        with open(plugin_path) as f:
            source = f.read()
        tree = ast.parse(source, filename=str(plugin_path))
        print("✓ Python 语法检查通过")
    except SyntaxError as e:
        print(f"✗ 语法错误: {e}")
        return False
    
    # 2. 查找 Provider 类
    provider_class = None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            # 检查是否继承自 TempMailProviderBase
            for base in node.bases:
                if isinstance(base, ast.Name) and 'TempMailProvider' in base.id:
                    provider_class = node
                    break
            if provider_class:
                break
    
    if not provider_class:
        print("✗ 未找到 TempMailProviderBase 子类")
        return False
    
    print(f"✓ 找到 Provider 类: {provider_class.name}")
    
    # 3. 检查 @register_provider 装饰器
    has_decorator = False
    for decorator in provider_class.decorator_list:
        if isinstance(decorator, ast.Name) and decorator.id == 'register_provider':
            has_decorator = True
            break
    
    if not has_decorator:
        print("✗ 缺少 @register_provider 装饰器")
        return False
    
    print("✓ @register_provider 装饰器存在")
    
    # 4. 检查 provider_name 属性
    provider_name = None
    for item in provider_class.body:
        if isinstance(item, ast.Assign):
            for target in item.targets:
                if isinstance(target, ast.Name) and target.id == 'provider_name':
                    if isinstance(item.value, ast.Constant):
                        provider_name = item.value.value
                        break
    
    if not provider_name:
        print("✗ 未找到 provider_name 类属性")
        return False
    
    print(f"✓ provider_name: {provider_name}")
    
    # 5. 检查必需的方法
    required_methods = [
        'get_options',
        'create_mailbox',
        'delete_mailbox',
        'list_messages',
        'get_message_detail',
        'delete_message',
        'clear_messages',
    ]
    
    implemented_methods = []
    for item in provider_class.body:
        if isinstance(item, ast.FunctionDef):
            implemented_methods.append(item.name)
    
    missing = [m for m in required_methods if m not in implemented_methods]
    
    if missing:
        print(f"✗ 缺少必需方法: {missing}")
        return False
    
    print(f"✓ 所有必需方法已实现 ({len(required_methods)}/{len(required_methods)})")
    for method in required_methods:
        print(f"  - {method}")
    
    # 6. 检查配置 schema
    has_config_schema = False
    for item in provider_class.body:
        if isinstance(item, ast.Assign):
            for target in item.targets:
                if isinstance(target, ast.Name) and target.id == 'config_schema':
                    has_config_schema = True
                    break
    
    if has_config_schema:
        print("✓ config_schema 已定义")
    else:
        print("⚠ config_schema 未定义（可选）")
    
    # 7. 统计辅助方法
    helper_methods = [m for m in implemented_methods if m.startswith('_') and m != '__init__']
    print(f"✓ 辅助方法数量: {len(helper_methods)}")
    
    # 8. 检查导入
    required_imports = ['requests', 'logging', 'settings_repo', 'TempMailProviderBase', 'register_provider']
    found_imports = []
    
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found_imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                found_imports.append(node.module)
            for alias in node.names:
                found_imports.append(alias.name)
    
    critical_missing = []
    for imp in ['requests', 'TempMailProviderBase', 'register_provider']:
        if not any(imp in found for found in found_imports):
            critical_missing.append(imp)
    
    if critical_missing:
        print(f"✗ 缺少关键导入: {critical_missing}")
        return False
    
    print("✓ 关键依赖导入完整")
    
    print("\n" + "="*50)
    print("✅ 插件验证通过")
    print("="*50)
    print(f"插件名称: {provider_name}")
    print(f"类名: {provider_class.name}")
    print(f"必需方法: {len(required_methods)}/{len(required_methods)}")
    print(f"辅助方法: {len(helper_methods)}")
    print(f"代码行数: {len(source.splitlines())}")
    print("\n插件已就绪，可随时部署。")
    
    return True


if __name__ == '__main__':
    success = verify_plugin()
    sys.exit(0 if success else 1)
