var Login = {
	key: "",
	user: null, //username

	init: function()
	{
		this.key = localStorage.getItem("bg:session");
		if( this.key )
			Login.checkSessionKey();
		else
			Login.statusChanged();

		this.login_button = Ladda.create( document.querySelector( "#login-dialog form button" ) );
		this.signup_button = Ladda.create( document.querySelector( "#signup-dialog form button" ) );
		//Ladda.bind( "#login-dialog form button");

		//$("#login-button").click( function() { $('#login-dialog').modal('show'); });
		$("#login-dialog form").submit( Login.actionLogin );
		$("#signup-dialog form").submit( Login.actionSignup );
		$(".logout-button").click( Login.actionLogout.bind(Login) );
	},

	checkSessionKey: function()
	{
		if(!Login.key) {
			return;
		}

		$.getJSON( SERVER_PATH + "action/login/check?key=" + Login.key).success( onOk ).fail( onUnknownError );

		function onOk(data)
		{
			if(data.status != 1)
			{
				Login.user = null;
				Login.key = "";
				Login.statusChanged();
				localStorage.removeItem("bg:session");
				return console.log("key not valid");
			}

			console.log("key is valid");
			Login.user = data.username;
			Login.statusChanged();
		}
	},

	actionLogin: function()
	{
		var username = $(this).find(".username-field").val();
		var password = $(this).find(".password-field").val();

		//$(this).css("opacity","0.1");
		Login.login_button.start();
		$("#login-dialog .alert").fadeOut();

		$.getJSON( SERVER_PATH + "action/login?user="+username+"&pass="+password).success( onLoginResponse ).fail( onLoginError );

		event.preventDefault();
		return true;

		function onLoginResponse(data)
		{
			Login.login_button.stop();

			if(data.status != 1)
			{
				$("#login-dialog .alert").html("Wrong username or password").fadeIn();
				return;
			}

			$("#login-dialog .alert").hide();
			$("#login-dialog").modal("hide");

			Login.user = data.username;
			Login.key = data.key;
			localStorage.setItem("bg:session", data.key);
			Login.statusChanged();
		}

		function onLoginError(v)
		{
			Login.login_button.stop();
			$("#login-dialog .alert").html("Error: Server not responding").fadeIn();
		}
	},

	actionLogout: function()
	{
		if(!Login.key) return;

		Login.user = null;
		Login.key = "";
		localStorage.removeItem("bg:session");

		$.getJSON( SERVER_PATH + "action/logout?key="+ Login.key ).success( onOk ).fail( onUnknownError );

		function onOk(v)
		{
			if(v.status != 1)
				console.log("key not valid");
			else
				console.log("key is valid, logout");
			Login.statusChanged();
		}
	},
	
	actionSignup: function()
	{
		var username = $(this).find(".username-field").val();
		var password = $(this).find(".password-field").val();
		var mail = $(this).find(".mail-field").val();

		//$(this).css("opacity","0.1");
		Login.signup_button.start();
		$("#signup-dialog .alert").fadeOut();

		$.getJSON( SERVER_PATH + "action/signup", {username:username, password:password, mail: mail} ).success( onSignupResponse ).fail( onSignupError );

		event.preventDefault();
		return true; 

		function onSignupResponse(data)
		{
			Login.signup_button.stop();

			if(data.status != 1)
			{
				$("#signup-dialog .alert").html(data.msg).fadeIn();
				return;
			}

			$("#signup-dialog .alert").hide();
			$("#signup-dialog").modal("hide");

			$("#signup-dialog .alert").html("Wrong username or password").fadeIn();
		}

		function onSignupError(v)
		{
			Login.signup_button.stop();
			$("#signup-dialog .alert").html("Error: Server not responding").fadeIn();
		}
	},	

	statusChanged: function()
	{
		if( Login.user )
		{
			$(".myUsername").html( Login.user );
			$("#intro").hide();
			$("#nav-user-area").show();
			$("#dashboard").show();
			$(App).trigger("login_changed", Login.user );
		}
		else
		{
			$("#intro").show();
			$("#nav-user-area").hide();
			$("#dashboard").hide();
		}
	}
};

function onUnknownError(v)
{
	console.log("unknown error");
}