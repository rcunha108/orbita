#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo 'Execute com sudo na maquina virtual Ubuntu da Oracle.' >&2
  exit 1
fi

. /etc/os-release
if [ "$ID" != ubuntu ] || [ "$VERSION_ID" != 24.04 ]; then
  echo 'Este helper foi preparado para Ubuntu 24.04 LTS.' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates git docker.io docker-compose-v2
systemctl enable --now docker

if [ -d /opt/orbita/.git ]; then
  if [ "$(git -C /opt/orbita remote get-url origin)" != 'https://github.com/rcunha108/orbita.git' ]; then
    echo '/opt/orbita pertence a outro repositorio; nenhum arquivo foi substituido.' >&2
    exit 1
  fi
  git -C /opt/orbita fetch origin main
  git -C /opt/orbita merge --ff-only origin/main
elif [ -e /opt/orbita ]; then
  echo '/opt/orbita ja existe; nenhum arquivo foi substituido.' >&2
  exit 1
else
  git clone --branch main --single-branch https://github.com/rcunha108/orbita.git /opt/orbita
fi

if [ ! -e /opt/orbita/.env.oracle ]; then
  install -m 600 /opt/orbita/.env.oracle.example /opt/orbita/.env.oracle
fi

echo 'Docker e codigo preparados em /opt/orbita.'
echo 'Configure .env.oracle no servidor, DNS e portas 80/443 antes de iniciar.'
echo 'Nenhuma chave foi preenchida e nenhum servico publico foi iniciado por este helper.'
