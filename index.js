const http = require("http");
const net = require("net");
const { URL } = require("url");

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("moo-proxy ok");
});

server.on("upgrade", (req, socket, head) => {
    let target;
    try {
        const reqUrl = new URL(req.url, "http://localhost");
        const targetParam = reqUrl.searchParams.get("target");
        if (!targetParam) throw new Error("no target");
        target = new URL(targetParam);
    } catch (e) {
        console.error("[proxy] bad request:", e.message);
        socket.destroy();
        return;
    }

    const port = target.port
        ? parseInt(target.port)
        : target.protocol === "wss:" ? 443 : 80;

    const upstream = net.connect(port, target.hostname, () => {
        const headers = [
            `GET ${target.pathname}${target.search} HTTP/1.1`,
            `Host: ${target.host}`,
            `Upgrade: websocket`,
            `Connection: Upgrade`,
            `Sec-WebSocket-Version: 13`,
            `Sec-WebSocket-Key: ${req.headers["sec-websocket-key"] || "dGhlIHNhbXBsZSBub25jZQ=="}`,
        ];
        if (req.headers["sec-websocket-protocol"])
            headers.push(`Sec-WebSocket-Protocol: ${req.headers["sec-websocket-protocol"]}`);
        headers.push("\r\n");
        upstream.write(headers.join("\r\n"));
    });

    upstream.on("error", (e) => { console.error("[proxy] upstream:", e.message); socket.destroy(); });
    socket.on("error", () => upstream.destroy());

    upstream.once("data", (chunk) => {
        socket.write(chunk);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });

    if (head && head.length) upstream.write(head);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`[proxy] listening on port ${PORT}`));
