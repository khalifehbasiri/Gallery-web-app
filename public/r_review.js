function remove_Review(button, i){
    let to_remove = button.value;
    let id = document.getElementById(`yes${i}`).value;
    let temp = {value: to_remove, id: id};
    let reviewEntry = button.closest(".review-entry");
    button.disabled = true;

    let xhttp = new XMLHttpRequest()
    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            reviewEntry.remove();
        } else {
            button.disabled = false;
            alert("The review could not be removed. Please try again.");
        }
    }
    xhttp.onerror = function() {
        button.disabled = false;
        alert("Could not connect to the server. Please try again.");
    }
    xhttp.open("POST", "/rRemove");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
}
