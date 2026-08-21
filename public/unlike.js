function unlike(param){
    let x = document.getElementById(`unlike${param}`).value;
    let temp = {value: x};
    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                location.reload();
            } else {
                alert("The artwork could not be unliked. Please try again.");
            }
        }
        xhttp.onerror = function() {
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/unlike");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
