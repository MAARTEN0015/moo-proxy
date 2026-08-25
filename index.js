const http = require("http");
const tls = require("tls");
const { URL } = require("url");

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
});

server.on("upgrade", (req, socket, head) => {
    let target;
    try {
        const u = new URL(req.url, "http://x");
        target = new URL(u.searchParams.get("target"));
    } catch(e) {
        socket.destroy();
        return;
    }

    const port = target.port ? parseInt(target.port) : 443;

    const upstream = tls.connect({ host: target.hostname, port, servername: target.hostname }, () => {
        const key = req.headers["sec-websocket-key"] || "dGhlIHNhbXBsZSBub25jZQ==";
        upstream.write(
            `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
            `Host: ${target.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n\r\n`
        );
    });

    upstream.once("data", chunk => {
        socket.write(chunk);
        socket.pipe(upstream);
        upstream.pipe(socket);
    });

    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    if (head && head.length) upstream.write(head);
});

server.listen(process.env.PORT || 8080, () => console.log("proxy up"));
