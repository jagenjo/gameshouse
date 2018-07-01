var Games = {
	games_list: {},
	current_game_id: -1,

	init: function()
	{
		$("#newgame-dialog form").submit( Games.actionCreate );
		this.creategame_button = Ladda.create( document.querySelector( "#newgame-dialog form button" ) );
		
		$(".form-invitegame").submit( Games.actionInviteToGame.bind(this) );
		$(".send-command-form").submit( Games.actionSendCommand.bind(this) );

		$("#update-games-list").click( Games.actionUpdateGamesList.bind(this) );
		this.updatelist_button = Ladda.create( document.querySelector( "#update-games-list" ) );

		$(".show-qrcode").click( Games.actionShowQR.bind(Games) );
		$(".edit-title").click( Games.actionEditTitle.bind(Games) );
		$(".edit-topic").click( Games.actionEditTopic.bind(Games) );
		
		$(".launch-game").click( Games.actionLaunchGame.bind(Games) );
		$(".sleep-game").click( Games.actionSleepGame.bind(Games) );
		$(".refresh-game").click( Games.refreshGameDashboard.bind(Games) );
		
		$(App).on("login_changed", function(e,user){
			if(user)
				Games.actionUpdateGamesList(); 
		});

		this.loadGamesList( function(){
			$("#gametypes-select-list").empty();
			for(var i in Games.games_list)
			{
				var game = Games.games_list[i];
				$("#gametypes-select-list").append("<option value='"+i+"'>" + game.name + "</select>");
			}
		});
	},
	
	loadGamesList: function( callback )
	{
		$.getJSON( SERVER_PATH + "action/getAvailableGamesList" ).success( function( resp ) {
			Games.games_list = resp.games;
			if(callback)
				callback( Games.games_list );
		}).fail( alert );
	},

	showDashboard: function()
	{
		$(".starter-template").hide();
		$("#dashboard").show();
	},

	actionCreate: function(e)
	{
		var $inputs = $('#newgame-dialog form :input');
		// not sure if you wanted this, but I thought I'd add it.
		// get an associative array of just the values.
		var values = {};
		$inputs.each(function() {
			if(this.name)
				values[this.name] = $(this).val();
		});

		$inputs.prop('disabled', true);
		Games.creategame_button.start();
		console.log(values);
		values.key = Login.key;

		$.getJSON( SERVER_PATH + "action/createGame", values ).success( onResponse ).fail( onError );

		e.preventDefault();
		return true;

		function onResponse(data)
		{
			Games.creategame_button.stop();

			if(data.status != 1)
			{
				$("#newgame-dialog .alert").html("Something wrong").fadeIn();
				return;
			}

			$("#newgame-dialog .alert").hide();
			$("#newgame-dialog").modal("hide");
			Games.actionUpdateGamesList();

			//TODO
		}

		function onError(v)
		{
			Games.creategame_button.stop();
			$("#newgame-dialog .alert").html("Error: Server not responding").fadeIn();
		}
	},

	actionUpdateGamesList: function()
	{
		if(!Login.key)
			console.error("not logged in");

		$.getJSON( SERVER_PATH + "action/getGames", { key: Login.key } ).success( onResponse );
		Games.updatelist_button.start();
		$("#dashboard .games-list tbody").css({opacity:0.5});

		function onResponse(data)
		{
			Games.updatelist_button.stop();
			$("#dashboard .games-list tbody").css({opacity:1}).empty();
			var index = 1;
			if(data.list)
				for(var i in data.list)
				{
					var game = data.list[i];
					var code = "<tr class='game-row-"+game.id+"'>";
					code += "<td><button type='button' data-id='"+ game.id +"' class='btn btn-sm btn-success play-game'><span class='glyphicon glyphicon-play'></span> Play</button></td>";
					//code += "<td>"+(index++)+"</td>";
					code += "<td><p>"+escapeHtml(game.title)+"</p><p class='topic'>"+escapeHtml(game.topic)+"</p></td>";
					code += "<td class='hidden-xs'>"+game.game+"</td>";
					code += "<td class='hidden-xs hidden-sm'>"+game.status+"</td>";
					code += "<td class='hidden-xs hidden-sm'>"+game.players+"</td>";
					//code += "<td class='hidden-xs hidden-sm'>Lobby</td>";
					code += "<td class='last-col'>";
					//code += "<button type='button' data-id='"+ game.id +"' class='btn btn-sm btn-primary invite-game'><span class='glyphicon glyphicon-user'></span> Invite</button> ";
					//code += "<button type='button' data-id='"+ game.id +"' class='btn btn-sm btn-success play-game'><span class='glyphicon glyphicon-play'></span> Play</button> ";
					code += "<button type='button' data-toggle='tooltip' data-placement='top' data-original-title='Invite' data-id='"+ game.id +"' class='btn btn-sm btn-info invite-user'><span class='glyphicon glyphicon-user'></span></button> ";
					if (game.author == Login.user)
					{
						if (game.running)
							code += "<button type='button' data-id='"+ game.id +"' data-toggle='tooltip' data-placement='top' data-original-title='Pause' class='btn btn-sm btn-info sleep-game'><span class='glyphicon glyphicon-pause'></span></button> ";
						code += "<button type='button' data-id='"+ game.id +"' data-toggle='tooltip' data-placement='top' data-original-title='Admin' class='btn btn-sm btn-warning admin-game'><span class='glyphicon glyphicon-cog'></span></button> ";
						code += "<button type='button' data-id='"+ game.id +"' data-toggle='tooltip' data-placement='top' data-original-title='Delete' class='btn btn-sm btn-danger delete-game'><span class='glyphicon glyphicon-trash'></span></button> ";
					}
					else
						code += "<button type='button' data-id='"+ game.id +"' data-toggle='tooltip' data-placement='top' data-original-title='Leave' class='btn btn-sm btn-info leave-game'><span class='glyphicon glyphicon-remove'></span></button> ";
					code += "</td></tr>\n";
					$("#dashboard .games-list tbody").append(code);
				}
				
			$("#dashboard .games-list button").tooltip();

			$("#dashboard .games-list tbody button.play-game").click( function() { 
				var id = this.dataset["id"];
				Games.actionPlayGame(id);
			});


			$("#dashboard .games-list tbody button.delete-game").click( function() { 
				var id = this.dataset["id"];
				Games.actionDeleteGame(id);
			});

			$("#dashboard .games-list tbody button.admin-game").click( function() { 
				var id = this.dataset["id"];
				Games.actionAdminGame(id);
			});
			
			$("#dashboard .games-list tbody button.sleep-game").click( function() { 
				var id = this.dataset["id"];
				Games.actionSleepGame(id);
			});
			
			$("#dashboard .games-list tbody button.invite-user").click( function() { 
				var id = this.dataset["id"];
				$(".form-invitegame .gameid-field").val(id);
				$("#invite-dialog").modal("show");
			});
		}
		
		//status		
		$.getJSON( SERVER_PATH + "action/getGamesStatus" ).success( function(status) {
			$("#games-status tbody").empty();
			for(var i in status.info)
			{
				$("#games-status tbody").append("<tr><td>"+i+"</td><td>"+status.info[i]+"</td></tr>");
			}
		}).fail( alert );
		
	},

	actionDeleteGame: function( id )
	{
		if(!id) 
			return;

		bootbox.confirm("Are you sure?", function(result) {
			if(result)
				$.getJSON( SERVER_PATH + "action/deleteGame", { id: id, key: Login.key }).success( function() {
					//Games.actionUpdateGamesList();
					$("tr.game-row-"+id).fadeOut(300, function() { $(this).remove(); });
				});
		}); 
	},

	actionPlayGame: function( id )
	{
		$.getJSON( SERVER_PATH + "action/playGame", { game_id: id, key: Login.key }).success( function(resp) {
			if(resp.status == -1)
			{
				console.error("action/playGame error: " + resp.msg);
				bootbox.alert("There has been an error launching the game.");
				return;
			}
			Games.playGame( resp.info.launch + "?game_id=" + id + "&key=" + Login.key );
		});
	},

	actionSleepGame: function( id )
	{
		$.getJSON( SERVER_PATH + "action/sleepGame", {game_id: id, key: Login.key }).success( function(resp) {
			Games.actionUpdateGamesList();
		});
	},

	actionAdminGame: function( id )
	{
		if(!id) 
			return;

		Games.current_game_id = id;
		Games.refreshGameDashboard();

		$("#dashboard").hide();
		$("#game-panel").show();
	},

	refreshGameDashboard: function( e, callback )
	{
		var that = this;
		var id = Games.current_game_id;

		$.getJSON( SERVER_PATH + "action/getGameAdminInfo", { game_id: id, key: Login.key }).success( function(resp) {
			if(resp.status != 1)
			{
				console.error("action/getGameAdminInfo error: " + resp.msg);
				bootbox.alert("There has been an error viewing the game.");
				return;
			}

			$(".form-invitegame .gameid-field").val(id);
			$("#game-panel .game-name").text( resp.info.title );
			$("#game-panel .topic .content").text( resp.info.topic );
			$("#game-panel .game-action").each( function(a,e){ e.dataset["game_id"] = id; });
			$("#game-panel .game-port").text( resp.info.port ? resp.info.port : "offline" );

			if( resp.info.running )
			{
				$("#game-panel .launch-game").hide();
				$("#game-panel .sleep-game").show();
			}
			else
			{
				$("#game-panel .sleep-game").hide();
				$("#game-panel .launch-game").show();
			}

			$(".players-list tbody").empty();

			for(var i in resp.users)
			{
				var score = 0;
				var user = resp.users[i];
				var button = '<button type="button" data-gameid="'+id+'" data-username="'+user.username+'" class="btn btn-sm btn-danger kick-player" data-original-title="" title=""><span class="glyphicon glyphicon-remove"></span></button>';
				if( user.username == resp.info.author )
					button = "";
				var user_status = resp.online_players && resp.online_players[ user.username ] ? "online" : "offline";
				var code = "<tr><td></td><td><span class='user-"+user_status+"'></span>"+user.username+"</td><td>"+user.info+"</td><td>"+user.score+'</td><td class="last-col">'+button+'</td></tr>';
				$(".players-list tbody").append(code);
			}

			$(".players-list tbody .kick-player").click(function(e){
				$.getJSON( SERVER_PATH + "action/kickFromGame", { game_id: this.dataset["gameid"], username: this.dataset["username"], key: Login.key }).success( function(resp) {
					Games.actionAdminGame(id);
				});
			});

			$("#game-log tbody").empty();
			if( resp.log )
			{
				for(var i in resp.log)
				{
					var line = JSON.parse( resp.log[i] );
					$("#game-log tbody").append("<tr><td>"+escapeHtml(line.msg)+"</td></tr>");
				}
			}

			var iframe = that.game_panel_iframe = $("#game-admin-panel iframe")[0];
			iframe.src = resp.info.panel;
			iframe.onload = function()
			{
				//console.log("loaded");
				this.contentWindow.addEventListener( "message", that.onGamePanelMessage.bind(that), false );
			}

			if(callback)
				callback(resp);
		});
	},

	actionSendCommand: function(e)
	{
		e.preventDefault();
		e.stopPropagation();

		var values = readForm( e.target );
		e.target.querySelector(".command_input").value = "";

		var cmd = values.command_input;
		if( !cmd )
			return;
		var packet = { type: "command", data: cmd };
		this.sendEvent( packet, function(){
			Games.refreshGameDashboard();
		});
	},

	sendEvent: function( event, callback )
	{
		var packet = JSON.stringify(event);

		$.getJSON( SERVER_PATH + "action/sendEvent", { game_id: Games.current_game_id, key: Login.key, event: packet }).success( function(resp) {
			if(resp.status != 1)
			{
				console.error("action/getGameAdminInfo error: " + resp.msg);
				bootbox.alert("There has been an error sending the event.");
				return;
			}
			if(callback)
				callback(resp);
		});
	},

	actionShowQR: function(e)
	{
		$("#qr-dialog").modal("show");
		var root = document.querySelector("#qr-dialog .qr-container");
		$(root).empty();
		var qrcode = new QRCode( root, {
			text: "QR STILL MISSING",
			width: 256,
			height: 256,
			colorDark : "#000000",
			colorLight : "#ffffff",
			correctLevel : QRCode.CorrectLevel.H
		});
	},

	actionEditTitle: function(e)
	{
		bootbox.prompt("Choose game title", function(v){
			if(!v)
				return;

			$.getJSON( SERVER_PATH + "action/setTitle", { game_id: Games.current_game_id, key: Login.key, title: v }).success( function(resp) {
				if(resp.status != 1)
				{
					console.error("action/getGameAdminInfo error: " + resp.msg);
					bootbox.alert("There has been an error changing the title.");
					return;
				}

				$("#game-panel .game-name").text( resp.title );
			});
		});
	},

	actionEditTopic: function(e)
	{
		bootbox.prompt("Choose topic", function(v){
			if(!v)
				return;

			$.getJSON( SERVER_PATH + "action/setTopic", { game_id: Games.current_game_id, key: Login.key, topic: v }).success( function(resp) {
				if(resp.status != 1)
				{
					console.error("action/getGameAdminInfo error: " + resp.msg);
					bootbox.alert("There has been an error changing the topic.");
					return;
				}

				$("#game-panel .topic .content").text( resp.topic );
			});
		});
	},
	
	actionInviteToGame: function(e)
	{
		$("#invite-dialog .alert").html("Error: User not found").fadeOut();
		
		var values = readForm( e.target );
		
		/*
		if (!Games.invite_button)
			Games.invite_button = Ladda.create( document.querySelector( "#invite-to-game-button" ) );
		Games.invite_button.start();
		*/
		
		$.getJSON( SERVER_PATH + "action/inviteToGame", { game_id: values.game_id, username: values.username_mail, key: Login.key }).success( function(resp) {
			//Games.invite_button.stop();
			
			if (resp.status != 1) {
				bootbox.alert("Error: " + resp.msg);
				return;
			}
			
			//show "invitation sent"
			$("#update-games-list").click( Games.actionUpdateGamesList );
			Games.refreshGameDashboard();
			
			//close
			$("#invite-dialog .alert").html("").hide();
			$("#invite-dialog").modal("hide");
		}).fail(onError);
		
		e.preventDefault();
		return true;
	
		function onError(v)
		{
			Games.invite_button.stop();
			$("#invite-dialog .alert").html("Error: Server not responding").fadeIn();
		}
	},

	actionLaunchGame: function(e)
	{
		var game_id = e.target.dataset["game_id"];
		if(!game_id || game_id == -1)
		{
			console.error("no game to launch");
			return;
		}

		$.getJSON( SERVER_PATH + "action/launchGame", { game_id: game_id, key: Login.key }).success( function(resp) {
			if (resp.status != 1) {
				console.error( resp.msg );
				bootbox.alert("There has been an error launching the game.");
				return;
			}
			Games.refreshGameDashboard();
		}).fail(onError);
		e.preventDefault();
		return true;
	
		function onError(v)
		{
			console.error( v );
		}
	},

	actionSleepGame: function(e)
	{
		var game_id = e.target.dataset["game_id"];
		if(!game_id || game_id == -1)
			return;

		$.getJSON( SERVER_PATH + "action/sleepGame", { game_id: game_id, key: Login.key }).success( function(resp) {
			if (resp.status != 1) {
				console.error( resp.msg );
				bootbox.alert("There has been an error sleeping the game.");
				return;
			}
			Games.refreshGameDashboard();
		}).fail(onError);
		e.preventDefault();
		return true;
	
		function onError(v)
		{
			console.error( v );
		}
	},

	playGame: function (path)
	{
		if(!path)
		{
			bootbox.alert("Game path missing");
			return;
		}

		var w = window.open( path, "");
		return w;
			
		return window.location.href = path;
		
		$("#wrap").hide();
		//$("#loading-box").fadeIn();
		$("#fullgame-wrap").show();
		$("#fullgame-wrap").html("<iframe src='"+path+"'></iframe>");		
	},

	onGamePanelMessage: function(event)
	{
		var that = this;
		if ( event.origin !== location.origin )
			return;
		var packet = JSON.parse( event.data );
		this.sendEvent( packet, function(resp){
			if(resp.event_response && that.game_panel_iframe)
				that.game_panel_iframe.contentWindow.onParentMessage( resp.event_response );
		});
	}
};


var entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

function escapeHtml (string) {
  return String(string).replace(/[&<>"'`=\/]/g, function (s) {
    return entityMap[s];
  });
}

function readForm( elem )
{
	var values = {};
	var inputs = elem.querySelectorAll("input");
	for( var i = 0; i < inputs.length; ++i )
		if(inputs[i].name)
			values[inputs[i].name] = $(inputs[i]).val();
	return values;
}