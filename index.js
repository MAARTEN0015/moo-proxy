const http = require("http");
const httpProxy = require("http-proxy");
const { URL } = require("url");

const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
});

server.on("upgrade", (req, socket, head) => {
    try {
        const target = new URL(req.url, "http://x").searchParams.get("target");
        if (!target) { socket.destroy(); return; }
        proxy.ws(req, socket, head, { target });
    } catch(e) {
        socket.destroy();
    }
});

proxy.on("error", (err, req, res) => {
    try { if (res && res.destroy) res.destroy(); } catch(e) {}
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log("proxy on", port));
