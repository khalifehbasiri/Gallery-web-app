function signup(name, user){
    let temp = {
        name: name,
        user: user
    };
    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                location.reload();
            } else {
                alert("You could not be signed up for the workshop. Please try again.");
            }
        }
        xhttp.onerror = function() {
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/signup");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
