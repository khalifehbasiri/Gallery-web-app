function remove_Review(review, i){
    let to_remove = review;
    console.log(i);
    let id = document.getElementById(`yes${i}`).value;
    let temp = {value: to_remove, id: id};
    let xhttp = new XMLHttpRequest()
    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            location.reload();
        } else {
            alert("The review could not be removed. Please try again.");
        }
    }
    xhttp.onerror = function() {
        alert("Could not connect to the server. Please try again.");
    }
    xhttp.open("POST", "/rRemove");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
}
