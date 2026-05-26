#!/bin/bash

# Menetapkan judul terminal
echo -ne "\033]0;CCTV Stream Manager\007"

# Berpindah ke direktori tempat script berada
cd "$(dirname "$0")" || exit

echo "[System] Menutup proses lama (FFmpeg & Node.js)..."
# Menggunakan -INT agar FFmpeg menutup file rekaman dengan rapi (mencegah file korup)
pkill -INT -f ffmpeg 2>/dev/null
pkill -f "node server.js" 2>/dev/null
pkill -f "cam[1-4].sh" 2>/dev/null

echo "[System] Membersihkan folder Streams lama..."
rm -rf Streams

echo "[System] Menyiapkan struktur folder baru..."
mkdir -p Streams/cam1 Streams/cam2 Streams/cam3 Streams/cam4
mkdir -p Rekaman/cam1 Rekaman/cam2 Rekaman/cam3 Rekaman/cam4

echo "[System] Menjalankan Backend Node.js..."
nohup node server.js > server.log 2>&1 &

sleep 2

echo "[System] Menjalankan semua kamera (Cam 1-4)..."
./cam1.sh > cam1.log 2>&1 &
./cam2.sh > cam2.log 2>&1 &
./cam3.sh > cam3.log 2>&1 &
./cam4.sh > cam4.log 2>&1 &

echo "---------------------------------------------------"
echo "SISTEM BERJALAN: Monitor di http://localhost:8000"
echo "---------------------------------------------------"

# Menunggu input Enter
read -p "Tekan [ENTER] untuk MEMATIKAN semua stream dan keluar..."

echo "[System] Menghentikan semua proses..."

# Perintah pkill sesuai permintaan Anda
pkill -f cam1.sh
pkill -f cam2.sh
pkill -f cam3.sh
pkill -f cam4.sh
pkill -INT -f ffmpeg 2>/dev/null
pkill -f "node server.js" 2>/dev/null

echo "[System] Semua proses telah dihentikan. Sampai jumpa!"
exit 0