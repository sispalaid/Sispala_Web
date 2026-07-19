import os

def main():
    env_vars = {}
    if os.path.exists('.env'):
        with open('.env') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env_vars[k.strip()] = v.strip()
    
    # Merge with system environment variables
    for k, v in os.environ.items():
        env_vars[k] = v

    paths = []
    for i in range(1, 5):
        url = env_vars.get(f'CAM{i}_RTSP_URL')
        if url:
            cam_lines = [
                f"  cam{i}:",
                f"    source: {url}"
            ]
            
            # 1. Configurable RTSP Protocol (TCP/UDP/Multicast/Automatic)
            protocol = env_vars.get(f'CAM{i}_PROXY_SOURCE_PROTOCOL')
            if protocol and protocol.lower() != 'automatic':
                cam_lines.append(f"    sourceProtocol: {protocol.lower()}")
                
            # 2. Configurable On Demand Streaming (yes/no)
            on_demand = env_vars.get(f'CAM{i}_PROXY_ON_DEMAND')
            if on_demand and on_demand.lower() == 'yes':
                cam_lines.append(f"    sourceOnDemand: yes")
                close_after = env_vars.get(f'CAM{i}_PROXY_ON_DEMAND_CLOSE_AFTER', '10s')
                cam_lines.append(f"    sourceOnDemandCloseAfter: {close_after}")
                
            paths.append("\n".join(cam_lines))
    
    config = f"""# MediaMTX configuration (generated dynamically)
rtspAddress: :8554

paths:
{"\n".join(paths)}
"""
    with open('mediamtx.yml', 'w') as f:
        f.write(config)
    print("Generated mediamtx.yml successfully!")

if __name__ == '__main__':
    main()
