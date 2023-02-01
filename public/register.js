// Change the host to localhost if you are running the server on your
// own computer.
let host = ["localhost", "YOUR_OPENSTACK_IP"];

window.addEventListener('load', () => { 

    document.getElementById("submit").onclick = save;

});

function save(){
    
	document.getElementById("error").innerHTML = "";
	let name = document.getElementById("name").value;
	let pass = document.getElementById("pass").value;
	let newUser = { username: name, password: pass };
	
	fetch(`http://${host[0]}:3000/register`, {
        method: 'POST', 
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newUser)
    })
    // fetch() returns a promise. When we have received a response from the server,
    // the promise's `then()` handler is called with the response.
    .then((response) => {
        // Our handler throws an error if the request did not succeed.
        if (!response.ok) {
			document.getElementById("name").value = '';
			document.getElementById("pass").value = '';
			document.getElementById("error").innerHTML = "That username is taken. Please use a different username.";
        } else {
			location.href=`http://${host[0]}:3000/home`;
		}
    })
    // Catch any errors that might happen, and display a message.
    .catch((error) => console.log(err));

}