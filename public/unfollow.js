function unfollow(username){
    console.log("here11");
    let to_unfollow = username;
    let temp = {value: to_unfollow};
    let xhttp = new XMLHttpRequest()
    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            location.reload();
        } else {
            alert("The artist could not be unfollowed. Please try again.");
        }
    }
    xhttp.onerror = function() {
        alert("Could not connect to the server. Please try again.");
    }
    xhttp.open("POST", "/unfollow");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
}
