## Setup workstation
```
sudo apt-get update && sudo apt-get install -y python3-venv
python3 -m venv .venv
source .venv/bin/activate
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

