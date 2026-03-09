#!/bin/bash

# 远程服务器地址（默认值）
REMOTE_SERVER="10.62.77.17"

# 显示使用说明
show_usage() {
    echo "使用方法: $0 [远程服务器地址]"
    echo "示例:"
    echo "  $0              # 使用默认服务器地址 10.62.77.17"
    echo "  $0 192.168.1.100 # 使用指定的服务器地址"
}

# 解析命令行参数
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_usage
    exit 0
fi

if [ -n "$1" ]; then
    REMOTE_SERVER="$1"
    echo "使用指定的服务器地址: ${REMOTE_SERVER}"
else
    echo "使用默认服务器地址: ${REMOTE_SERVER}"
fi

# 创建临时目录
TMP_DIR=$(mktemp -d)
TMP_TAR="${TMP_DIR}/acl.tar.gz"

echo "使用临时目录: ${TMP_DIR}"

# 清理函数
cleanup() {
    echo "清理临时文件..."
    rm -rf "${TMP_DIR}"
    echo "清理完成"
}

# 设置退出时清理
trap cleanup EXIT

# 克隆仓库到临时目录
echo "克隆仓库到临时目录..."
git clone ~/code/c_ACL "${TMP_DIR}/c_ACL"

# 打包到临时目录
echo "打包项目..."
tar -czf "${TMP_TAR}" --no-mac-metadata -C "${TMP_DIR}" c_ACL

# 上传到远程服务器
echo "上传到远程服务器 ${REMOTE_SERVER}..."
scp "${TMP_TAR}" root@${REMOTE_SERVER}:~/deploy/acl.tar.gz

# 在远程服务器解包（2>&1 将stderr重定向到stdout，然后用grep过滤掉警告）
echo "在远程服务器解包..."
ssh root@${REMOTE_SERVER} 'cd deploy && tar -zxf acl.tar.gz 2>&1 | grep -v "LIBARCHIVE.xattr" | grep -v "line editing not enabled"'

# 进入源代码目录并创建部署标签
echo "创建部署标签..."
cd ~/code/c_ACL
current_time=$(date +"%Y%m%d_%H%M%S")
# 将 IP 地址中的点号替换为破折号，便于作为标签名
ip_tag=$(echo "${REMOTE_SERVER}" | tr '.' '-')
git tag "deploy_${ip_tag}_${current_time}"
echo "创建了标签: deploy_${ip_tag}_${current_time}"

echo "部署完成！"

