%% Check required MATLAB functions/toolboxes for this project

requiredItems = [
    "rigidBodyTree";
    "rigidBodyJoint";
    "inverseKinematics";
    "trapveltraj";
    "checkCollision";
    "collisionBox";
    "collisionCylinder"
];

fprintf("Checking Robot Arm Digital Twin requirements...\n\n");

allFound = true;
for i = 1:numel(requiredItems)
    item = requiredItems(i);
    found = exist(item, "file") || exist(item, "class");

    if found
        fprintf("[OK]      %s\n", item);
    else
        fprintf("[MISSING] %s\n", item);
        allFound = false;
    end
end

fprintf("\nInstalled toolbox overview:\n");
disp(ver);

if allFound
    fprintf("\nAll required project functions were found. You can run main.m.\n");
else
    fprintf("\nSome functions are missing. Install/check Robotics System Toolbox first.\n");
end
