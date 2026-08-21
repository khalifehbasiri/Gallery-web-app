function add_workshop(){
    let RequiredFields = ["name", "goal", "duration"]
    let workshop = {}

    for (let field of RequiredFields){
        workshop[field] = document.getElementById("W" + field).value;

        if (workshop[field] == ""){
            alert("Missing " + field + " field!");
            return;
        } 
    }

    if (isNaN(workshop.duration)){
        alert("duration must be a number in weeks!");
        return;
    }

    workshop.user = ""
    workshop.signed = []

    let xhttp = new XMLHttpRequest()

    xhttp.onload = function() {
        if (this.status >= 200 && this.status < 300) {
            window.location.href = "/Account";
        } else {
            alert("The Workshop could not be added. Please try again.");
        }
    };
    xhttp.onerror = function() {
        alert("Could not connect to the server. Please try again.");
    };

    xhttp.open("POST", "/addWorkshop");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(workshop));
}
