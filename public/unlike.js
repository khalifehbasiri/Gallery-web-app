function unlike(param){
    let button = document.getElementById(`unlike${param}`);
    let x = button.value;
    let temp = {value: x};
    button.disabled = true;

    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                button.id = `like${param}`;
                button.textContent = "\u2661";
                button.onclick = function() {
                    like(param);
                };
                document.getElementById(`likeCount${param}`).textContent = this.response.numLikes;
            } else {
                alert("The artwork could not be unliked. Please try again.");
            }
            button.disabled = false;
        }
        xhttp.onerror = function() {
            button.disabled = false;
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/unlike");
        xhttp.responseType = "json";
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
