window.addEventListener('load', (event) => {
    document.getElementById("accType").addEventListener("click", changeType);
});


function changeType(){
    let accType = document.getElementById("accType1").value;
    let temp = {value: accType};
    let xhttp = new XMLHttpRequest()
        xhttp.onload = function() {
            if (this.status >= 200 && this.status < 300) {
                window.location.href = "/Account";
            } else {
                alert("The account type could not be changed. Please try again.");
            }
        }
        xhttp.onerror = function() {
            alert("Could not connect to the server. Please try again.");
        }
        xhttp.open("POST", "/accType");
        xhttp.setRequestHeader("Content-Type", "application/json");
        xhttp.send(JSON.stringify(temp));
}
