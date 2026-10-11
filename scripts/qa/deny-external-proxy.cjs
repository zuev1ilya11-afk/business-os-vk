// Local QA deny proxy: no forwarding and no outbound connections.
const http=require('node:http');
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('deny-external ready')}console.error('BLOCKED external HTTP '+req.method+' '+req.url);res.writeHead(403);res.end('External calls denied in local QA')});
server.on('connect',(req,socket)=>{console.error('BLOCKED external CONNECT '+req.url);socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')});server.listen(4280,'127.0.0.1');
