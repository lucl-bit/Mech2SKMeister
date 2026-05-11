function [qWaypoints, ikInfo] = solveWaypointIK(robot, waypointTforms)
%SOLVEWAYPOINTIK Solve inverse kinematics for all task waypoints.

ik = inverseKinematics("RigidBodyTree", robot);
weights = [0.25, 0.25, 0.25, 1.0, 1.0, 1.0];

numWaypoints = size(waypointTforms, 3);
numJoints = numel(homeConfiguration(robot));
qWaypoints = zeros(numWaypoints, numJoints);
ikInfo = struct();
ikInfo.Status = strings(numWaypoints, 1);
ikInfo.PoseErrorNorm = nan(numWaypoints, 1);
ikInfo.Iterations = nan(numWaypoints, 1);
ikInfo.Raw = cell(numWaypoints, 1);

qGuess = homeConfiguration(robot);

for i = 1:numWaypoints
    [qSol, solInfo] = ik("tool", waypointTforms(:, :, i), weights, qGuess);
    qWaypoints(i, :) = qSol;
    ikInfo.Raw{i} = solInfo;
    ikInfo.Status(i) = readStatus(solInfo);
    ikInfo.PoseErrorNorm(i) = readNumericField(solInfo, ["PoseErrorNorm", "PoseError"]);
    ikInfo.Iterations(i) = readNumericField(solInfo, ["Iterations", "NumIterations"]);
    qGuess = qSol;
end
end

function status = readStatus(solInfo)
%READSTATUS Handle small release-to-release differences in IK solution info.

if isfield(solInfo, "Status")
    status = string(solInfo.Status);
elseif isfield(solInfo, "ExitFlag")
    status = "ExitFlag " + string(solInfo.ExitFlag);
else
    status = "unknown";
end
end

function value = readNumericField(solInfo, fieldNames)
%READNUMERICFIELD Return the first available numeric scalar field.

value = nan;
for i = 1:numel(fieldNames)
    name = char(fieldNames(i));
    if isfield(solInfo, name) && isnumeric(solInfo.(name)) && isscalar(solInfo.(name))
        value = solInfo.(name);
        return;
    end
end
end
