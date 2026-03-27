cmd_Release/nitro5.node := ln -f "Release/obj.target/nitro5.node" "Release/nitro5.node" 2>/dev/null || (rm -rf "Release/nitro5.node" && cp -af "Release/obj.target/nitro5.node" "Release/nitro5.node")
