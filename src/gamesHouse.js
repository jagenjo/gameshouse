

//external
var express = require('express');
var expressWs = require('express-ws');
var fs = require('fs');

//internal
var Users = require('./users');
var GamesDB = require('./gamesDB');
var GamesHost = require('./gamesHost');
var DB = require('./database');

var GamesHouse = { version: 0.01 };

function Server( config )
{
	this.config = config;

	DB.init( config );
	this.db = new GamesDB();

	//Users.init( config );

	this.host = new GamesHost();
	this.host.loadGamesList( this.config.games_list_file );

	this.modules = [];

	this.modules.push( Users );
	this.modules.push( this.db );
	this.modules.push( this.host );
}

GamesHouse.Server = Server;

Server.prototype.start = function(port)
{
	port = port || 8081;

	this.express_server = express();
	this.ws_server = expressWs( this.express_server );
	
	this.express_server.use(function(req, res, next) {
	  res.header("Access-Control-Allow-Origin", "*");
	  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
	  next();
	});

	//call inits
	for( var i in this.modules )
		if( this.modules[i].init )
			this.modules[i].init( this, this.config );

	//register paths for httpd
	this.registerPaths( this.express_server );

	
	this.express_server.listen( port, function() {
	  console.log('listening on port ',port);
	});

	/*
	var last_id = 0;
	var clients = {};
	this.express_server.ws('/', function(ws, req) {
		var id = last_id++;
		clients[id] = ws;
		ws.id = id;
		ws.send( JSON.stringify({id:id}) );
		ws.on('message', function(msg) {
			ws.send(msg);
		});
		ws.on('close', function(msg) {
			delete clients[id];
		});
	});
	*/
}
	
Server.prototype.registerPaths = function( express_server )
{
	var that = this;

	this.express_server.use( express.static( this.config.public_folder || "public" ) );

	this.express_server.get('/', function(req, res) {
	  res.send('If you are reading this means the public folder was not configured propertly, check the config.js');
	});

	for(var i in this.modules)
		if( this.modules[i].registerPaths )
			this.modules[i].registerPaths( this.express_server );
}

Server.prototype.close = function(callback)
{
	if(this.exited) 
		return;
		
	this.exited = true;
	console.log("GamesHouse exit ...");
	for(var i in this.modules)
		if( this.modules[i].exit )
			this.modules[i].exit();
	DB.exit();
	if(callback) 
		setTimeout(callback, 2000); //give two seconds to close all
}

Server.prototype.getInfo = function()
{
	return "unknown";
}

module.exports = GamesHouse;
