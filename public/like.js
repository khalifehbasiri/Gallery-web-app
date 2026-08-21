function like(param){
    let x = document.getElementById(`like${param}`).value;
    let temp = {value: x};
    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                location.reload();
            } else {
                alert("The artwork could not be liked. Please try again.");
            }
        }
        xhttp.onerror = function() {
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/like");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
