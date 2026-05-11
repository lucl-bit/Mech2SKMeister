function robot = createDemoRobot()
%CREATEDEMOROBOT Create a 6-DOF serial manipulator using DH parameters.
% The dimensions are UR-style but intentionally generic, so the project
% works without downloading a commercial robot model.

robot = rigidBodyTree("DataFormat", "row", "MaxNumBodies", 7);
robot.Gravity = [0, 0, -9.81];

% Standard DH parameters: [a alpha d thetaOffset].
% Units: meters and radians.
dh = [
     0.0000,  pi/2, 0.1519, 0;
    -0.2437,  0.00, 0.0000, 0;
    -0.2132,  0.00, 0.0000, 0;
     0.0000,  pi/2, 0.1124, 0;
     0.0000, -pi/2, 0.0854, 0;
     0.0000,  0.00, 0.0819, 0
];

parentName = robot.BaseName;
for i = 1:size(dh, 1)
    body = rigidBody("link" + i);
    joint = rigidBodyJoint("joint" + i, "revolute");
    setFixedTransform(joint, dh(i, :), "dh");
    joint.PositionLimits = [-pi, pi];
    body.Joint = joint;

    % Simple collision capsule around each link. This keeps collision checks
    % useful even without detailed CAD meshes.
    addApproximateLinkCollision(body, i);

    addBody(robot, body, parentName);
    parentName = body.Name;
end

tool = rigidBody("tool");
toolJoint = rigidBodyJoint("tool_fixed", "fixed");
setFixedTransform(toolJoint, trvec2tform([0, 0, 0.10]));
tool.Joint = toolJoint;
addCollision(tool, collisionCylinder(0.025, 0.10), trvec2tform([0, 0, 0.05]));
addBody(robot, tool, parentName);
end

function addApproximateLinkCollision(body, linkIndex)
%ADDAPPROXIMATELINKCOLLISION Add rough geometry for collision checking.

switch linkIndex
    case 1
        geom = collisionCylinder(0.055, 0.15);
        pose = trvec2tform([0, 0, 0.075]);
    case {2, 3}
        geom = collisionBox(0.24, 0.055, 0.055);
        pose = trvec2tform([-0.12, 0, 0]);
    case 4
        geom = collisionCylinder(0.045, 0.12);
        pose = trvec2tform([0, 0, 0.06]);
    case 5
        geom = collisionCylinder(0.04, 0.10);
        pose = axang2tform([1, 0, 0, pi/2]) * trvec2tform([0, 0, 0.05]);
    otherwise
        geom = collisionCylinder(0.035, 0.09);
        pose = trvec2tform([0, 0, 0.045]);
end

addCollision(body, geom, pose);
end
