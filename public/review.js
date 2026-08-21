function addreview(i){
    let id = document.getElementById(`yes${i}`).value;
    let Input = document.getElementById(`rInput${i}`).value;
    let temp = {value: Input, id: id};
    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                location.reload();
            } else {
                alert("The review could not be added. Please try again.");
            }
        }
        xhttp.onerror = function() {
            alert("Could not connect to the server. Please try again.");
        }
        console.log(temp);
        xhttp.open("POST", "/rsubmit");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
