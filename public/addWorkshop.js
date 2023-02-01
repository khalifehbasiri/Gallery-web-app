function add_workshop(){
    let name = document.getElementById("Wname").value;
    let goal = document.getElementById("Wgoal").value;
    let duration = document.getElementById("Wduration").value;

    if (name == ""){
        alert("Missing name field!");
        return;
    }
    if (goal == ""){
        alert("Missing year field!");
        return;
    }
    if (duration == ""){
        alert("Missing category field!");
        return;
    }
    if (isNaN(duration)){
        alert("duration must be a number in weeks!");
        return;
    }

    let temp = {
        user: "",
        name: name,
        goal: goal,
        duration: duration,
        signed: []
    }

    let xhttp = new XMLHttpRequest()
    xhttp.onreadystatechange = function() {
        if (this.readyState == 4 && this.status == 200) {
        }
    }
    xhttp.open("POST", "/addWorkshop");
    xhttp.setRequestHeader("Content-Type", "application/json");
    xhttp.send(JSON.stringify(temp));
    
    location.reload();
}