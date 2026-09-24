#!/bin/bash
# Bootstrap for the UPTour portal host.
#
# Installs Docker and the compose plugin only. The application stack is deployed
# separately rather than baked in here, so a failed deploy never leaves the machine
# half-built and unreachable — and so re-deploying does not mean re-provisioning.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git

# Docker's own repository: Ubuntu's packaged docker.io lags and ships no compose plugin.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
usermod -aG docker ubuntu

# 2GB of RAM is enough to run the stack but not to build it: the OpenWA image pulls in
# chromium and its toolchain, and the build gets OOM-killed without headroom. Swap is the
# cheapest way to buy that headroom — adding RAM would cost the same every month for a
# need that only arises during builds.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer RAM, but use swap rather than dying.
  sysctl -w vm.swappiness=20
  echo 'vm.swappiness=20' > /etc/sysctl.d/99-swappiness.conf
fi

mkdir -p /opt/uptour
chown ubuntu:ubuntu /opt/uptour

touch /var/lib/cloud/uptour-bootstrap-done
