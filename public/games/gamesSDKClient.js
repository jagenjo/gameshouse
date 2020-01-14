//this SDK is meant to be used by the GameClient to communicate with the GameCore
//used in client side
//this doesnt contain info about other players because that depends entirely on the Game Server.

var GSDK = {
	host: location.hostname, //where is the games host located (required to stablish a connection)
	path: '', //set by config
	
	binded: [],
	
	connect: function(key, game_id, on_ready)
	{
		var _this = this;
		this.key = key;
		//retrieve game public state
		getJSON( GSDK.path + "action/playGame", { game_id: game_id, key: key }, this.onGetGameInfo.bind(this, on_ready), alert);
	},
	
	onGetGameInfo: function( callback, resp )
	{
		if(!resp || resp.status != 1)
			throw("Error connecting to game, server said: " + resp.msg);

		if(!resp.port)
			throw("Error connecting to game, port missing");

		
		this.username = resp.username;
		var info = resp.info;
		
		this.connectSocket( resp.port, function() {
			if(callback)
				callback(info);
		});
	},
	
	connectSocket: function( game_port, callback)
	{
		var _this = this;
		_this.retrying = false;
		
		var path = this.key;
		var protocol = location.protocol == "http:" ? "ws://" : "wss://";
		
		var ws = this.socket = new WebSocket( protocol + GSDK.host + ':' + game_port + '/' + path);
		ws.onopen = function(evt) {
			_this.retry = -1;
			console.log('socket connected');
			_this.dispatchEvent("connected");
			if(callback)
				callback();
		};
		
		ws.onmessage = function(evt)
		{
			//console.log("MSG: ", evt.data );
			_this.dispatchEvent("message",evt.data);
		}
		
		ws.onerror = function(evt)
		{
			console.log("connection error");
			_this.dispatchEvent("connection_error",evt);
			_this.socket = null;

			_this.retryConnection(game_port);	
		}
		
		ws.onclose = function(evt)
		{
			console.log("closed");
			_this.dispatchEvent("disconnected");
			_this.socket = null;

			_this.retryConnection(game_port);	
		}
		
		this.socket = ws;
		
		console.log("waiting socket...");
	},
	
	retryConnection: function(game_port)
	{
		if(this.retrying)
			return;
		if(this.retry > 10)
		{
			console.log("too many retries");
			this.dispatchEvent("server_down");
			return;
		}
		console.log("retrying...");
		this.retrying = true;
		this.retry++; 
		setTimeout( this.connectSocket.bind( this, game_port), 5000 );
	},

	send: function(msg)
	{
		if (this.socket)
			this.socket.send(msg);
	},
	
	addEventListener: function(type, callback)
	{
		var callbacks = this.binded[type];
		if(!callbacks)
			callbacks = this.binded[ type ] = [];
		callbacks.push(callback);
	},

	removeEventListener: function(type, callback)
	{
		var callbacks = this.binded[type];
		if(!callbacks) return;
	
		var pos = callbacks.indexOf(callback);
		if(pos != -1)
			callback.splice(pos,1);	
	},

	dispatchEvent: function(type, evt)
	{
		var callbacks = this.binded[type];
		if(!callbacks) return;
	
		for(var i in callbacks)
			callbacks[i](evt,type);
	}
}

//functions
function getQueryParams() {
	var qs = window.location.search;
    qs = qs.split("+").join(" ");

    var params = {}, tokens,
        re = /[?&]?([^=]+)=([^&]*)/g;

    while (tokens = re.exec(qs)) {
        params[decodeURIComponent(tokens[1])]
            = decodeURIComponent(tokens[2]);
    }

    return params;
}

function isServerGame()
{
	var params = getQueryParams();
	if(params["key"] && params["game_id"])
		return true;
	return false;
}

function getJSON(url, params, callback, error)
{
	if(params)
	{
		var params_str = null;
		var params_arr = [];
		for(var i in params)
			params_arr.push(i + "=" + params[i]);
		params_str = params_arr.join("&");
		url = url + "?" + params_str;
	}

	var xhr = new XMLHttpRequest();
	xhr.open('GET', url, true);
	xhr.onload = function()
	{
		var response = this.response;
		if(this.status != 200)
		{
			if(error)
				error(this.status);
			return;
		}

		if(callback)
			callback( typeof(this.response) == "string" ? JSON.parse(this.response) : this.response);
		return;
	}

	xhr.onerror = function(err)
	{
		if(error)
			error(err);
	}

	/*
	if(params)
	{
		var params_str = JSON.stringify(params);
		xhr.setRequestHeader("Content-type", "application/json; charset=utf-8");
		xhr.send(params_str);
	}
	else
		*/
	xhr.send();

	return xhr;
}

