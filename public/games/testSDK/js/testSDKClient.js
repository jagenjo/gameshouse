var TestGame = {
	init: function()
	{
		//retrieve game info
		GSDK.host = location.hostname;
		GSDK.path = "/";
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