function like(param){
    let button = document.getElementById(`like${param}`);
    let x = button.value;
    let temp = {value: x};
    button.disabled = true;

    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                button.id = `unlike${param}`;
                button.textContent = "\u2665";
                button.onclick = function() {
                    unlike(param);
                };
                document.getElementById(`likeCount${param}`).textContent = this.response.numLikes;
            } else {
                alert("The artwork could not be liked. Please try again.");
            }
            button.disabled = false;
        }
        xhttp.onerror = function() {
            button.disabled = false;
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/like");
        xhttp.responseType = "json";
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
