function signup(name, user){
    let temp = {
        name: name,
        user: user
    };
    let xhttp = new XMLHttpRequest()
        xhttp.onreadystatechange = function() {
            if (this.readyState == 4 && this.status == 200) {
            }
        }
        xhttp.open("POST", "/signup");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));

        location.reload();
}