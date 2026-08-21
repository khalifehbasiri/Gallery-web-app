function follow(id){
    console.log("here");
    let temp = {value: id};
    console.log(temp);
    let xhttp = new XMLHttpRequest()
    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            location.reload();
        } else {
            alert("The artist could not be followed. Please try again.");
        }
    }
    xhttp.onerror = function() {
        alert("Could not connect to the server. Please try again.");
    }
    xhttp.open("POST", "/follow");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
}
