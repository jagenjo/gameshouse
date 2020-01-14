# GamesHouse

GamesHouse is a platform to host simple multiplayer javascript games.

The idea is that you can easily create games that benefit from the next features:

- Permanent connection with all online players
- Database to store game state
- Game backend running only when players are online
- Users can connect, do their actions and disconnect and the game keeps the state updated

## How to make your own game

First you must create a folder inside the ```public/games``` with the name of your game. Save in this folder all the files of your game (HTML, JS, CSS).
Including the ones related to the server.

You must create the Game Server, this is a file that contains the code that the server must execute when the game is running, there is an example below.

Once you have the server, you can create the client that will connect with the platform. There is an example below.

Finally you must add the game to the games-list.json file in the gameshouse root folder:

```json
	"TestSDK": {
		"name":"Test SDK",
		"description":"this game allows to test all the functionalities of the Games SDK",
		"version":"0.1",
		"launch":"games/testSDK/",
		"folder":"../public/games/testSDK/",
		"includes": ["js/testSDKServer.js"],
		"panel": "admin.html"
	}
```

Now when someone creates a game in the platform the option to use that game will appear.

## The Game Server

Here is an example of a simple game server. This class will be executed inside the server, so you can have all the game logic here. This class is also in charge of sending the info to the clients when they are connected.

The server will handle the launch and sleep of this class automatically, according to if there are users online.

```js
function TestGameCore()
{
	SERVER.log("TestGameCore launched v0.1");
	this.server = SERVER;

	//internal game data
	this.data = {
		ticks: 0,
		topic: 'Welcome!',
		log: [],
		users: {}
	};

	//counter used to sleep game if nobody inside
	this.empty_ticks = 0;

	//attach important events
	SERVER.addEventListener('player_connected', this.onPlayerConnected.bind(this));
	SERVER.addEventListener('player_disconnected', this.onPlayerDisconnected.bind(this));
	SERVER.addEventListener('player_message', this.onPlayerMessage.bind(this));
	SERVER.addEventListener('system', this.onSystemEvent.bind(this));
	SERVER.addEventListener('sleep', this.onSleep.bind(this));
	SERVER.addEventListener('event', this.onServerEvent.bind(this));

	//recover game state
	SERVER.loadData('game_state', (function(val) {
		if (!val)
			return;
		
		this.data = JSON.parse(val);
		for(var i in this.data.users)
			this.data.users[i].online = false;
	}).bind(this));
	
	//launch ticks
	setTimeout( this.onTick.bind(this), 5000);

	SERVER.start();
}

//example of events received from the system (new players joining the game)
TestGameCore.prototype.onSystemEvent = function(event)
{
	SERVER.log(" * system event! logging it = ", event.type );

	var msg = "";
	
	switch(event.type)
	{
		case "new_player": msg = "<strong>Player "+event.username+" joined the game</strong>";
			this.data.users[ event.username ] = { online: false };
			break;
		case "player_leave": msg = "<strong>Player "+event.username+" left the game</strong>";
			delete this.data.users[ event.username ];
			break;
		default: break;
	}

	//store message in game log
	this.logMessage(msg);

	//send message to all participants
	SERVER.sendMessage("MSG|" + msg);
}

//actions performed from the Game Dashboard panels
TestGameCore.prototype.onServerEvent = function( event )
{
	if(event.type == "command")
	{
		var data = event.data;
		var t = data.split(" ");
		if(t[0] == "say")
			SERVER.sendMessage("MSG|Admin says - " + t.slice(1).join(" ") );
		else if(t[0] == "clear")
		{
			this.data.log = [];
			SERVER.sendMessage("CLEAR");
		}
		else if(t[0] == "get_users")
			return { type:"users", data: SERVER.clients.length  };
		else if(t[0] == "get_ticks")
			return { type:"ticks", data: this.data.ticks  };
		else
			SERVER.sendMessage("MSG|Admin says - " + data );
		SERVER.log(" * command: ", event.data );
	}
}

//called when a client is connected to the instance
TestGameCore.prototype.onPlayerConnected = function( player )
{
	this.data.users[ player.username ].online = true;
	
	//send game initial state to player
	player.send( "STATE|" + JSON.stringify( this.data ) );
	
	var msg = " + Player connected: " + player.username;
	this.logMessage(msg);
	SERVER.sendMessage("ON|" + player.username);	
	SERVER.sendMessage("MSG|" + msg);	
}

//called when a client sends a message
TestGameCore.prototype.onPlayerMessage = function(event)
{
	var that = this;
	var msg = event.data;

	//special command
	if(msg[0] == '/')
	{
		var cmd = msg.substr(1,10).split(' ')[0].toLowerCase();
		var content = msg.substr(cmd.length + 2);
		switch(cmd)
		{
			case 'topic': 
				this.data.topic = content;
				this.logMessage( event.username + " changed the topic to " + content );
				SERVER.setTopic( content );
				SERVER.sendMessage( "TOPIC|" + content );
				break;
			case 'info': 
				this.server.setPlayerInfo( event.username, content, function(v){ SERVER.log("update done? " + (v?"yes":"no") ); });
				this.logMessage( event.username + " changed his info " + content );
				SERVER.sendMessage( "MSG|" + event.username + " info changed: " + content );
				break;
			default: break;
		}
		return;
	}

	//regular message
	msg = event.username + ": " + msg;

	//store
	this.logMessage(msg);

	//resend to all clients
	SERVER.sendMessage("MSG|" + msg);
}

//called when a client disconnects
TestGameCore.prototype.onPlayerDisconnected = function(player) 
{
	this.data.users[ player.username ].online = false;
	
	//send game initial state to player
	var msg = " - Player disconnected: " + player.username;
	this.logMessage(msg);
	SERVER.sendMessage("OFF|" + player.username);	
	SERVER.sendMessage("MSG|" + msg);	
}

//called automatically by gameHost when sleeping the app
TestGameCore.prototype.onSleep = function()
{
	//save state
	SERVER.log(" - going to sleep...");
	SERVER.storeData('game_state', JSON.stringify( this.data ) );
}

//internal game logic ***********************************

//used to do actions every second
TestGameCore.prototype.onTick = function()
{
	if (SERVER.state != "RUNNING")
		return;
	
	this.data.ticks++;

	//check if we should go to sleep
	//SERVER.log(" Tick:", this.data.ticks, "Users now:", SERVER.clients.length );
	if(SERVER.clients.length == 0)
		this.empty_ticks++;
	else
		this.empty_ticks = 0;
		
	//a game can choose to go to sleep any time
	if(this.empty_ticks > 10) //ten seconds empty and is time to sleep
		SERVER.sleep();
	else
		setTimeout( this.onTick.bind(this), 1000);
}

//stores a message inside the log (but do not send it to clients)
TestGameCore.prototype.logMessage = function(msg)
{
	//save in log	
	this.data.log.push(msg);
	if(this.data.log.length > 100) //max messages
		this.data.log.shift();
}


//declare the main class to instantiate
this.main = TestGameCore;
```

## The Game Client

Here is an example of a game client.

Your HTML must include the SDK located in the games folder ```../gamesSDKClient.js``` to gain access to all the features.


```js
var TestGame = {
	init: function()
	{
		//retrieve game info
		GSDK.host = location.hostname;
		GSDK.path = "/gameshouse/";
		var params = getQueryParams();
		
		GSDK.connect( params["key"], params["game_id"], this.onConnect.bind(this) );
		GSDK.addEventListener('disconnected', this.onDisconnect.bind(this) );
		GSDK.addEventListener('connection_error', this.onConnectionError.bind(this) );
		GSDK.addEventListener('message', this.onMessage.bind(this) );
		GSDK.addEventListener('server_down', this.onServerDown.bind(this) );
		
		document.getElementById('text-input').onkeypress = function(e){
			if (!e) e = window.event;
			var keyCode = e.keyCode || e.which;
			if (keyCode == '13'){
			  // Enter pressed
			  var text = $("#text-input").val();
			  GSDK.send(text);
			  $("#text-input").val("");
			  return false;
			}
		}
	},
	
	onConnect: function(info)
	{
		console.log('READY!',info);
		$(".loading").remove();
	},
	
	onDisconnect: function(info)
	{
		this.appendMessage("<div class='msg'>DISCONNECTED... retrying</div>");
	},

	onServerDown: function(info)
	{
		this.appendMessage("<div class='msg'>SERVER NOT RESPONDING, REFRESH WEB</div>");
	},
	
	onConnectionError: function(err)
	{
		this.appendMessage("<div class='msg'>SERVER CONNECTION ERROR: "+err+"</div>");
	},
	
	onMessage: function(msg)
	{
		console.log("SERVER MSG: \"" + msg + "\"");
		var code = msg.substr(0,10).split("|")[0];
		var content = msg.substr( code.length + 1 );
		
		try
		{
			//an example of a simple protocol 
			switch(code)
			{
				case 'TOPIC':
					$("#topic").html(content);
					break;
				case 'STATE':
					var state = JSON.parse(content);
					$("#messages .msg").remove();
					$("#topic").html(state.topic);
					for(var i in state.log)
						this.appendMessage("<div class='msg'>"+state.log[i]+"</div>");
					break;
				case 'CLEAR':
					$("#messages .msg").remove();
					break;
				case 'ON': 
					this.setUser(content,true);
					break;
				case 'OFF': 
					this.setUser(content,false);
					break;
				case 'MSG': 
					this.appendMessage("<div class='msg'>"+content+"</div>");
					break;
				case 'TICK': 
					break;
			}
		}
		catch(err)
		{
			console.error(msg);
		}
		
	},

	appendMessage: function(msg)
	{
		$("#messages").append(msg);
		var objDiv = document.getElementById("messages");
		objDiv.scrollTop = objDiv.scrollHeight;	
	},

	setUser: function( username, state )
	{
		var sidebar = document.getElementById("sidebar");
		var div = sidebar.querySelector( "." + username );
		if(!div)
		{
			if(state)
				$(sidebar).append("<div class='user "+username+"'>" + username + "</div>");
		}
		else
		{
			if(!state)
				$(div).remove();
		}
	},
}
```
