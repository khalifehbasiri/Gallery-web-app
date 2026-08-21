function addreview(i){
    let id = document.getElementById(`yes${i}`).value;
    let Input = document.getElementById(`rInput${i}`).value;
    let temp = {value: Input, id: id};
    let submitButton = document.getElementById(`rSubmit${i}`);
    submitButton.disabled = true;

    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                let review = this.response.review;
                let reviewEntry = document.createElement("div");
                reviewEntry.className = "review-entry";

                reviewEntry.append("User: ");

                let userLink = document.createElement("a");
                userLink.href = `/artist/${review.userId}`;
                userLink.textContent = review.user;
                reviewEntry.appendChild(userLink);
                reviewEntry.appendChild(document.createElement("br"));

                let removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "review-remove";
                removeButton.value = review.review;
                removeButton.textContent = "X";
                removeButton.onclick = function() {
                    remove_Review(removeButton, i);
                };
                reviewEntry.appendChild(removeButton);
                reviewEntry.append(` ${review.review}`);

                document.getElementById(`reviews${i}`).appendChild(reviewEntry);
                document.getElementById(`rInput${i}`).value = "";
            } else {
                alert("The review could not be added. Please try again.");
            }
            submitButton.disabled = false;
        }
        xhttp.onerror = function() {
            submitButton.disabled = false;
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/rsubmit");
        xhttp.responseType = "json";
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
