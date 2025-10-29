## Setup workstation
```
sudo apt-get update && sudo apt-get install -y python3-venv
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip setuptools wheel
```
## Build StRS Site Index
```
python build_index.py --root "gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/Photogrammetric Imagery/StRS_Sites/" --out-dir ./docs/optical --group-depth 4 --per-dataset-max-files 500
```
```
gsutil -m rsync -r "./docs/optical" "gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/data_management/dataset_index/Photogrammetric Imagery/StRS_Sites"
```
## Build Fixed Site Index
```
python ./build_index_fixed_sites.py --root "gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/Photogrammetric Imagery/Fixed_Sites/" --out-dir ./docs/optical/fixed_sites --group-depth 5 --per-dataset-max-files 500
```
```
gsutil -m rsync -r "./docs/optical/fixed_sites" "gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/data_management/dataset_index/Photogrammetric Imagery/Fixed_Sites"
```
## Build Fixed Site DEM/Ortho page
```
python build_all_optical_products.py --out-dir ./docs/datasets/optical-products
```
```
gsutil -m rsync -r "./docs/datasets/optical-products" "gs://nmfs_odp_pifsc/PIFSC/ESD/ARP/data_management/dataset_index/optical-products/vital-rates"
```

## Other
```
curl -fsSL https://code-server.dev/install.sh | bash
mkdir -p ~/.config/code-server

cat ~/.config/code-server/config.yaml
bind-addr: 127.0.0.1:8080
auth: password
password: 
cert: false

code-server
```
