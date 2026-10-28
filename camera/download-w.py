from huggingface_hub import hf_hub_download
path = hf_hub_download(repo_id="rabahdev/fire-smoke-yolov8n", filename="best.pt", local_dir="weights")
print(path)